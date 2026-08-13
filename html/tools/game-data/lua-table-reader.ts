type LuaScalar = string | number | boolean | null;
export type LuaValue = LuaScalar | LuaTable;
export interface LuaTable { [key: string]: LuaValue }

export class LuaTableReaderError extends Error {
  constructor(file: string, line: number, column: number, message: string) {
    super(`${file}:${line}:${column}: ${message}`);
    this.name = "LuaTableReaderError";
  }
}

type TokenKind = "identifier" | "string" | "number" | "symbol" | "eof";
interface Token { kind: TokenKind; value: string; line: number; column: number }

class Lexer {
  private index = 0;
  private line = 1;
  private column = 1;
  constructor(private readonly source: string, private readonly file: string) {}
  private error(message: string): never { throw new LuaTableReaderError(this.file, this.line, this.column, message); }
  private current(): string { return this.source[this.index] ?? ""; }
  private advance(): string { const value = this.current(); this.index++; if (value === "\n") { this.line++; this.column = 1; } else this.column++; return value; }
  next(): Token {
    while (true) {
      while (/\s/.test(this.current())) this.advance();
      if (this.current() === "-" && this.source[this.index + 1] === "-") { while (this.current() && this.current() !== "\n") this.advance(); continue; }
      break;
    }
    const line = this.line; const column = this.column; const char = this.current();
    if (!char) return { kind: "eof", value: "", line, column };
    if (char === "\"" || char === "'") { const quote = this.advance(); let value = ""; while (this.current() && this.current() !== quote) { if (this.current() === "\\") { this.advance(); const escaped = this.advance(); value += escaped === "n" ? "\n" : escaped; } else value += this.advance(); } if (!this.current()) this.error("unterminated string"); this.advance(); return { kind: "string", value, line, column }; }
    if (/[0-9]/.test(char) || (char === "-" && /[0-9]/.test(this.source[this.index + 1] ?? ""))) {
      let value = this.advance(); let dots = 0;
      while (/[0-9.]/.test(this.current())) { const next = this.advance(); if (next === ".") dots++; value += next; }
      if (dots > 1 || !Number.isFinite(Number(value))) this.error(`malformed numeric literal '${value}'`);
      return { kind: "number", value, line, column };
    }
    if (/[A-Za-z_$]/.test(char)) { let value = this.advance(); while (/[A-Za-z0-9_$]/.test(this.current())) value += this.advance(); return { kind: "identifier", value, line, column }; }
    if ("{}[]=,.".includes(char)) { this.advance(); return { kind: "symbol", value: char, line, column }; }
    this.error(`unsupported token '${char}'`);
  }
}

class Parser {
  private token: Token;
  private readonly constants: LuaTable = {};
  constructor(private readonly lexer: Lexer, private readonly file: string) { this.token = lexer.next(); }
  private fail(message: string): never { throw new LuaTableReaderError(this.file, this.token.line, this.token.column, message); }
  private consume(value?: string): Token { const token = this.token; if (value && token.value !== value) this.fail(`expected '${value}', found '${token.value || "end of file"}'`); this.token = this.lexer.next(); return token; }
  parse(): LuaTable {
    const declarations: LuaTable = {};
    while (this.token.kind !== "eof") {
      const local = this.token.kind === "identifier" && this.token.value === "local";
      if (local) this.consume();
      if (this.token.kind !== "identifier") this.fail("only table declarations are permitted");
      const name = this.consume().value;
      this.consume("=");
      const value = this.value();
      if (Object.prototype.hasOwnProperty.call(declarations, name) || Object.prototype.hasOwnProperty.call(this.constants, name)) this.fail(`duplicate top-level declaration '${name}'`);
      if (name === "$CONTENT_DATA") {
        if (!local || typeof value !== "string") this.fail("$CONTENT_DATA must be a local string constant");
        this.constants[name] = value;
      } else {
        if (typeof value !== "object" || value === null) this.fail("only table declarations are permitted at top level");
        declarations[name] = value;
      }
    }
    return declarations;
  }
  private value(): LuaValue {
    if (this.token.kind === "string") { let value = this.consume().value; while (this.token.value === ".") { this.consume("."); this.consume("."); const right = this.value(); if (typeof right !== "string") this.fail("concatenation requires strings"); value += right; } return value; }
    if (this.token.kind === "number") return Number(this.consume().value);
    if (this.token.kind === "identifier") {
      const name = this.consume().value;
      if (name === "true") return true; if (name === "false") return false; if (name === "nil") return null;
      const constant = this.constants[name]; if (constant === undefined) this.fail(`executable expression or unknown identifier '${name}' is not permitted`);
      let value = constant; while (this.token.value === ".") { this.consume("."); this.consume("."); const right = this.value(); if (typeof value !== "string" || typeof right !== "string") this.fail("concatenation requires strings"); value += right; } return value;
    }
    if (this.token.value === "{") return this.table();
    this.fail("only literal table values are permitted");
  }
  private table(): LuaTable {
    this.consume("{"); const table: LuaTable = {}; let arrayIndex = 1;
    while (this.token.value !== "}") {
      if (this.token.kind === "eof") this.fail("unterminated table");
      let key: string;
      if (this.token.value === "[") { this.consume("["); const value = this.value(); if (typeof value !== "string" && typeof value !== "number") this.fail("table key must be a string or number"); key = String(value); this.consume("]"); this.consume("="); }
      else if (this.token.kind === "identifier") { const possibleKey = this.consume().value; if (this.token.value !== "=") this.fail("only named table entries are permitted"); this.consume("="); key = possibleKey; }
      else key = String(arrayIndex++);
      const value = this.value();
      if (Object.prototype.hasOwnProperty.call(table, key)) {
        if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(key)) this.fail(`duplicate UUID '${key}'`);
        this.fail(`duplicate table key '${key}'`);
      }
      table[key] = value;
      if (this.token.value === ",") this.consume(","); else if (this.token.value !== "}") this.fail("expected ',' or '}'");
    }
    this.consume("}"); return table;
  }
}

/** Parses declarations only; it never evaluates, imports, or executes Lua. */
export function parseLuaDeclarations(source: string, file = "<lua>"): LuaTable {
  return new Parser(new Lexer(source, file), file).parse();
}
