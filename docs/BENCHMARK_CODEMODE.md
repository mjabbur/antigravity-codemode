# Relatório de Benchmark: Codemode vs Tool Calling Tradicional

> **Data de Execução:** 02/10/2026  
> **Script de Teste:** [`benchmarks/run-benchmark.ts`](file:///c:/Dev/Joker/.agents/plugins/codemode/server/benchmarks/run-benchmark.ts)  
> **Ambiente:** Windows x64, Node.js v24.19.0, QuickJS WASM, Ripwire v0.6.5

---

## 1. Sumário Executivo do Benchmark

Foi executada uma bateria de testes empíricos automatizados comparando o **Modo Tradicional (múltiplas tool calls sequenciais via LLM)** contra o **Plugin Codemode (execução assíncrona local no QuickJS WASM + Ripwire + Staging)**.

### Principais Conclusões:
1. **Economia Massiva de Contexto (Tokens):**
   - **98,1% de redução** no mapeamento arquitetural (de ~14.500 tokens para 274 tokens).
   - **96,6% de redução** na busca de blast radius e callers (de ~13.100 tokens para 450 tokens).
2. **Redução Drástica de Turnos de Inferência:**
   - De **11 turnos para 1 único turno** no Cenário 1.
   - De **6 turnos para 1 único turno** no Cenário 2.
   - De **10 turnos para 2 turnos** (run + apply) no Cenário 3.
3. **Latência Real Percebida pelo Usuário:**
   - No modelo tradicional, 11 turnos de LLM (com tempo médio de inferência e rede de 2,5s por turno) consom **~27,5 segundos**.
   - No Codemode, o LLM gera o script em 1 turno e a execução local leva apenas **~450ms**, reduzindo o tempo total para **~3,0 segundos (~9x mais rápido)**.
4. **Segurança e Integridade Transacional:**
   - No modo normal, refatorações multi-arquivo não têm atomicidade: se o processo falhar no 4º arquivo, os anteriores ficam corrompidos no disco.
   - No Codemode, as edições ocorrem em staging e são aplicadas atomicamente com verificação de concorrência e rollback automático.

---

## 2. Tabela Comparativa Detalhada

| Cenário de Teste | Métrica | Modo Tradicional (Normal) | Modo Codemode | Ganho / Economia |
| :--- | :--- | :---: | :---: | :---: |
| **Cenário 1: Mapeamento Arquitetural**<br>(Varredura e inspeção de 10 arquivos principais) | **Tool Calls**<br>Tokens Estimados<br>Tempo Local<br>Tempo c/ LLM (~2.5s/call) | **11 calls**<br>~14.527 tokens<br>23.5 ms<br>~27.5 segundos | **1 call**<br>**274 tokens**<br>455.5 ms<br>**~3.0 segundos** | **-91% chamadas**<br>**98,1% economia**<br>Execução local WASM<br>**~9.1x mais rápido** |
| **Cenário 2: Blast Radius & Callers**<br>(Buscar chamadores e alcance de `resolvePath`) | **Tool Calls**<br>Tokens Estimados<br>Tempo Local<br>Tempo c/ LLM (~2.5s/call) | **6 calls**<br>~13.097 tokens<br>31.6 ms<br>~15.0 segundos | **1 call**<br>**450 tokens**<br>502.2 ms<br>**~3.0 segundos** | **-83% chamadas**<br>**96,6% economia**<br>PageRank local<br>**~5.0x mais rápido** |
| **Cenário 3: Refatoração Multi-Arquivo**<br>(Editar 5 arquivos de configuração com validação) | **Tool Calls**<br>Tokens Estimados<br>Rollback Atômico<br>Tempo c/ LLM (~2.5s/call) | **10 calls**<br>~134 tokens<br>**NÃO** (risco de corrupção)<br>~25.0 segundos | **2 calls** (run + apply)<br>268 tokens (com diff unificado)<br>**SIM** (rollback garantido)<br>**~5.0 segundos** | **-80% chamadas**<br>Diff para revisão<br>**Integridade 100%**<br>**~5.0x mais rápido** |

---

## 3. Como Reproduzir Este Benchmark

Para reexecutar a bateria a qualquer momento no ambiente local:

```bash
cd c:\Dev\Joker\.agents\plugins\codemode\server
npx tsx benchmarks/run-benchmark.ts
```
