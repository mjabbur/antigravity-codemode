# Diretriz de Uso do Plugin Codemode

> **Escopo:** Diretriz de Desenvolvimento e Navegação de Código  
> **Prioridade:** Alta para tarefas arquiteturais e multi-arquivo

---

## 1. Princípio de Eficiência de Contexto e Ferramentas

Sempre que a tarefa envolver:
1. **Mapeamento Arquitetural**: Conhecer a estrutura de um projeto, módulos principais e funções centrais.
2. **Grafo de Chamadas e Blast Radius**: Identificar quem chama determinada função ou calcular o raio de impacto de uma mudança.
3. **Refatoração Multi-Arquivo**: Modificar 2 ou mais arquivos de forma coordenada.

**Prefira utilizar o `codemode_run`** em vez de disparar dezenas de tool calls sequenciais de leitura e busca.

---

## 2. Padrões Obrigatórios

1. **Staging-first**:
   - Mutações geradas via `tools.writeFile` e `tools.editFile` dentro do script ficam retidas na memória.
   - Sempre revise o diff unificado retornado por `codemode_run` antes de chamar `codemode_apply`.
   - Se houver divergências ou erro no plano, execute `codemode_discard`.

2. **Navegação de Código**:
   - Use `tools["ripwire.map"]` para entender a hierarquia do projeto via Personalized PageRank.
   - Use `tools["ripwire.impact"]` antes de renomear ou alterar a assinatura de um método compartilhado.
   - Use `tools["ripwire.callers"]` para encontrar pontos de chamada imediatos.
