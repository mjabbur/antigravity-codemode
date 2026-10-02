# Spec 01: QuickJS WASM Sandbox Engine & IPC Protocol

> **Fase:** 1 (Scaffold e Núcleo do Sandbox)  
> **Status:** Aprovada para Codificação  
> **Componente:** `server/src/sandbox/`  
> **Referência:** `@earendil-works/pi-codemode` (Pi 1.0)

---

## 1. Objetivo e Escopo

Esta especificação define o motor isolado de execução de código JavaScript baseado em **QuickJS compilado para WebAssembly** (`quickjs-wasi`).
O motor deve executar scripts assíncronos escritos por modelos de IA em uma **Worker Thread** dedicada, com comunicação estrita via IPC assíncrono com a thread host do Node.js, controle de quota de memória e mecanismo atômico de interrupção contra loops infinitos.

---

## 2. Contratos de Tipos e Protocolo IPC

### 2.1. Tipos Compartilhados (`types.ts`)

```typescript
export interface CodemodeToolContext {
  signal: AbortSignal;
}

export interface CodemodeTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  execute: (args: unknown, context: CodemodeToolContext) => Promise<unknown> | unknown;
}

export type CodemodeOutputItem =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export type CodemodeCallStatus = "ok" | "error" | "cancelled";

export interface CodemodeCall {
  name: string;
  status: CodemodeCallStatus;
  durationMs: number;
}

export type CodemodeErrorKind = "script" | "timeout" | "aborted" | "sandbox";

export interface CodemodeError {
  kind: CodemodeErrorKind;
  name?: string;
  message: string;
  stack?: string;
}

export interface CodemodeStoreWrites {
  set: Record<string, unknown>;
  delete: string[];
}

export type CodemodeResult =
  | {
      ok: true;
      value: unknown;
      output: CodemodeOutputItem[];
      calls: CodemodeCall[];
      storeWrites: CodemodeStoreWrites;
    }
  | {
      ok: false;
      error: CodemodeError;
      output: CodemodeOutputItem[];
      calls: CodemodeCall[];
    };

export interface CodemodeSandboxOptions {
  tools?: readonly CodemodeTool[];
  timeoutMs?: number;
  memoryLimitBytes?: number;
  wasm?: object | Promise<object>;
  workerUrl?: string | URL;
}

export interface CodemodeExecuteOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  store?: Readonly<Record<string, unknown>>;
}
```

### 2.2. Protocolo de Comunicação Host <-> Worker (`protocol.ts`)

O canal IPC ocorre entre a thread principal (Host) e a Worker Thread (`node:worker_threads`):

```typescript
export interface ToolMetadata {
  name: string;
  jsName: string;
  description: string;
}

export interface WorkerData {
  code: string;
  tools: ToolMetadata[];
  wasm: object;
  memoryLimitBytes?: number;
  store: Record<string, string>;
  interrupt: SharedArrayBuffer; // Buffer de 4 bytes para interrupção atômica
}

// Mensagens enviadas do Worker para o Host
export type WorkerToHostMessage =
  | {
      type: "call";
      id: number;
      target: "tool";
      name: string;
      args?: string; // JSON serializado
    }
  | {
      type: "output";
      item: CodemodeOutputItem;
    }
  | {
      type: "done";
      ok: true;
      value?: string; // JSON serializado
      writes: string; // JSON serializado de CodemodeStoreWrites
    }
  | {
      type: "done";
      ok: false;
      error: string; // JSON serializado com { name, message, stack }
    }
  | {
      type: "crash";
      message: string;
    };

// Mensagens enviadas do Host para o Worker
export type HostToWorkerMessage = {
  type: "result";
  id: number;
  ok: boolean;
  payload?: string; // JSON serializado do valor ou mensagem de erro
};
```

---

## 3. Invariantes de Comportamento e Segurança

1. **Interrupção Atômica de Loops Infinitos:**
   - O Worker deve registrar um `interruptHandler` na VM QuickJS:
     ```typescript
     interruptHandler: () => Atomics.load(new Int32Array(data.interrupt), 0) !== 0
     ```
   - No caso de timeout ou abort, o Host executa:
     ```typescript
     Atomics.store(new Int32Array(this.interrupt), 0, 1);
     await this.worker.terminate();
     ```
   - O tempo máximo para interrupção não deve exceder `timeoutMs + 200ms`.

2. **Confinamento de Memória (Quota Heap):**
   - O QuickJS deve ser instanciado com `memoryLimit: options.memoryLimitBytes` (padrão: 256 MiB).
   - Alocações que excedam o limite devem lançar `InternalError: out of memory` capturável dentro do script ou resultar em `result.error.kind = "script"`.

3. **Supressão de Saídas Stdout/Stderr da VM:**
   - O shim WASI do QuickJS deve descartar saídas para `fd 1` e `fd 2` (`discardOutput`) para impedir que mensagens de diagnóstico em C/WASM poluam o terminal ou quebrem o canal JSON-RPC do MCP.

4. **Preservação de Linhas para Autocorreção:**
   - O wrapper do script deve compartilhar a linha 1 com o código do modelo:
     ```javascript
     (async (tools, console) => {${data.code}\n})
     ```
   - Os números de linha nas mensagens de erro e stack traces devem bater exatamente com o código submetido.

5. **Detecção de Promessas Estagnadas (*Stalled Promises*):**
   - Se o script retornar uma Promise que não pode ser resolvida (por exemplo, `await new Promise(() => {})`) e não houver nenhuma chamada de ferramenta pendente no Host, a função `stalled()` do prelude deve falhar imediatamente com erro explicativo, em vez de esperar o timeout completo.

6. **Proxy Amigável de Ferramentas:**
   - Acesso a `tools.<ferramenta_inexistente>` deve lançar `TypeError` com sugestão inteligente (*Did you mean tools.xxx?*).

---

## 4. Matriz de Testes de Invariantes (Critérios de Aceite)

| Teste | Entrada | Comportamento Esperado |
| :--- | :--- | :--- |
| **T01: Execução Básica** | `return 40 + 2;` | `result.ok === true`, `result.value === 42` |
| **T02: Chamada de Tool** | `const r = await tools.echo({ v: "hi" }); return r;` | `result.ok === true`, `result.value === "hi"` |
| **T03: Loop Infinito** | `while(true) {}` com timeout 1000ms | Conclui em ~1s com `result.error.kind === "timeout"` |
| **T04: Limite de Memória** | `'x'.repeat(300 * 1024 * 1024)` | Lança `out of memory`, não derruba o processo Host |
| **T05: Erro de Sintaxe** | `const = 1;` | `result.error.kind === "script"`, stack indica `codemode.js:1` |
| **T06: Helpers de Output** | `text("Linha 1"); console.log("Linha 2");` | `result.output` contém 2 itens de texto na ordem |
| **T07: Stalled Promise** | `await new Promise(() => {})` | Falha imediata (sem esperar timeout) indicando ausência de timers |
| **T08: Typo em Tool** | `await tools.read_fle()` | Lança `TypeError: tools.read_fle does not exist. Did you mean tools.readFile?` |
