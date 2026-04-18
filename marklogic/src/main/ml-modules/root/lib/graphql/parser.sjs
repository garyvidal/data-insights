'use strict';
/**
 * parser.sjs
 * GraphQL query string → AST (pure SJS, no external dependencies)
 *
 * Produces a document AST of the form:
 * {
 *   kind: "Document",
 *   definitions: [
 *     {
 *       kind: "OperationDefinition",   // or "FragmentDefinition"
 *       operation: "query",            // "query" | "mutation" | "subscription"
 *       name: "MyQuery",               // may be null
 *       variableDefinitions: [...],
 *       selectionSet: { kind: "SelectionSet", selections: [...] }
 *     }
 *   ]
 * }
 *
 * Each selection is one of:
 *   Field       : { kind:"Field", alias, name, arguments, directives, selectionSet }
 *   InlineFragment: { kind:"InlineFragment", typeCondition, directives, selectionSet }
 *   FragmentSpread: { kind:"FragmentSpread", name, directives }
 */

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

const TOKEN = {
  SOF:          '<SOF>',
  EOF:          '<EOF>',
  BANG:         '!',
  DOLLAR:       '$',
  PAREN_L:      '(',
  PAREN_R:      ')',
  SPREAD:       '...',
  COLON:        ':',
  EQUALS:       '=',
  AT:           '@',
  BRACKET_L:    '[',
  BRACKET_R:    ']',
  BRACE_L:      '{',
  BRACE_R:      '}',
  PIPE:         '|',
  NAME:         'Name',
  INT:          'Int',
  FLOAT:        'Float',
  STRING:       'String',
  BLOCK_STRING: 'BlockString',
};

function Lexer(source) {
  this.source = source;
  this.pos    = 0;
  this.line   = 1;
  this.col    = 1;
}

Lexer.prototype.advance = function() {
  this._skipWhitespaceAndComments();
  if (this.pos >= this.source.length) {
    return { kind: TOKEN.EOF };
  }
  const ch = this.source[this.pos];

  // Punctuation
  const PUNCT = { '!':TOKEN.BANG, '$':TOKEN.DOLLAR, '(':TOKEN.PAREN_L,
                  ')':TOKEN.PAREN_R, ':':TOKEN.COLON, '=':TOKEN.EQUALS,
                  '@':TOKEN.AT,    '[':TOKEN.BRACKET_L, ']':TOKEN.BRACKET_R,
                  '{':TOKEN.BRACE_L, '}':TOKEN.BRACE_R, '|':TOKEN.PIPE };
  if (PUNCT[ch]) { this.pos++; return { kind: PUNCT[ch], value: ch }; }

  // Spread ...
  if (ch === '.' && this.source.substr(this.pos, 3) === '...') {
    this.pos += 3;
    return { kind: TOKEN.SPREAD, value: '...' };
  }

  // Block string """
  if (ch === '"' && this.source.substr(this.pos, 3) === '"""') {
    return this._readBlockString();
  }

  // Regular string "
  if (ch === '"') return this._readString();

  // Number
  if (ch === '-' || (ch >= '0' && ch <= '9')) return this._readNumber();

  // Name / keyword
  if (ch === '_' || (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) {
    return this._readName();
  }

  throw new Error(`Unexpected character '${ch}' at position ${this.pos}`);
};

Lexer.prototype._skipWhitespaceAndComments = function() {
  while (this.pos < this.source.length) {
    const ch = this.source[this.pos];
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' || ch === ',') {
      this.pos++;
    } else if (ch === '#') {
      // Line comment
      while (this.pos < this.source.length && this.source[this.pos] !== '\n') {
        this.pos++;
      }
    } else {
      break;
    }
  }
};

Lexer.prototype._readName = function() {
  let start = this.pos;
  while (this.pos < this.source.length) {
    const c = this.source[this.pos];
    if (c === '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) {
      this.pos++;
    } else {
      break;
    }
  }
  return { kind: TOKEN.NAME, value: this.source.slice(start, this.pos) };
};

Lexer.prototype._readNumber = function() {
  let start = this.pos;
  let isFloat = false;
  if (this.source[this.pos] === '-') this.pos++;
  while (this.pos < this.source.length && this.source[this.pos] >= '0' && this.source[this.pos] <= '9') {
    this.pos++;
  }
  if (this.pos < this.source.length && this.source[this.pos] === '.') {
    isFloat = true;
    this.pos++;
    while (this.pos < this.source.length && this.source[this.pos] >= '0' && this.source[this.pos] <= '9') {
      this.pos++;
    }
  }
  if (this.pos < this.source.length && (this.source[this.pos] === 'e' || this.source[this.pos] === 'E')) {
    isFloat = true;
    this.pos++;
    if (this.source[this.pos] === '+' || this.source[this.pos] === '-') this.pos++;
    while (this.pos < this.source.length && this.source[this.pos] >= '0' && this.source[this.pos] <= '9') {
      this.pos++;
    }
  }
  const raw = this.source.slice(start, this.pos);
  return { kind: isFloat ? TOKEN.FLOAT : TOKEN.INT, value: raw };
};

Lexer.prototype._readString = function() {
  this.pos++; // skip opening "
  let value = '';
  while (this.pos < this.source.length) {
    const c = this.source[this.pos];
    if (c === '"') { this.pos++; break; }
    if (c === '\\') {
      this.pos++;
      const esc = this.source[this.pos++];
      const ESCAPES = { '"':'"', '\\':'\\', '/':'/', b:'\b', f:'\f', n:'\n', r:'\r', t:'\t' };
      if (ESCAPES[esc] !== undefined) {
        value += ESCAPES[esc];
      } else if (esc === 'u') {
        const hex = this.source.substr(this.pos, 4);
        value += String.fromCharCode(parseInt(hex, 16));
        this.pos += 4;
      }
    } else {
      value += c;
      this.pos++;
    }
  }
  return { kind: TOKEN.STRING, value };
};

Lexer.prototype._readBlockString = function() {
  this.pos += 3; // skip """
  let raw = '';
  while (this.pos < this.source.length) {
    if (this.source.substr(this.pos, 3) === '"""') {
      this.pos += 3;
      break;
    }
    raw += this.source[this.pos++];
  }
  // Minimal block string value — trim leading/trailing blank lines
  const value = raw.replace(/^\n/, '').replace(/\n[ \t]*$/, '');
  return { kind: TOKEN.BLOCK_STRING, value };
};

// ---------------------------------------------------------------------------
// Token stream (peekable)
// ---------------------------------------------------------------------------

function TokenStream(source) {
  this.lexer   = new Lexer(source);
  this._peeked = null;
}

TokenStream.prototype.peek = function() {
  if (!this._peeked) this._peeked = this.lexer.advance();
  return this._peeked;
};

TokenStream.prototype.next = function() {
  if (this._peeked) {
    const t = this._peeked;
    this._peeked = null;
    return t;
  }
  return this.lexer.advance();
};

TokenStream.prototype.expect = function(kind) {
  const t = this.next();
  if (t.kind !== kind) {
    throw new Error(`Expected token ${kind} but got ${t.kind} ("${t.value}")`);
  }
  return t;
};

TokenStream.prototype.expectKeyword = function(kw) {
  const t = this.next();
  if (t.kind !== TOKEN.NAME || t.value !== kw) {
    throw new Error(`Expected keyword "${kw}" but got ${t.kind} ("${t.value}")`);
  }
  return t;
};

TokenStream.prototype.skip = function(kind) {
  if (this.peek().kind === kind) { this.next(); return true; }
  return false;
};

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function Parser(source) {
  this.ts = new TokenStream(source);
}

Parser.prototype.parse = function() {
  const definitions = [];
  // A document may start with shorthand { ... } (anonymous query)
  while (this.ts.peek().kind !== TOKEN.EOF) {
    definitions.push(this._parseDefinition());
  }
  return { kind: 'Document', definitions };
};

Parser.prototype._parseDefinition = function() {
  const token = this.ts.peek();
  if (token.kind === TOKEN.BRACE_L) {
    // Shorthand anonymous query
    return {
      kind:      'OperationDefinition',
      operation: 'query',
      name:      null,
      variableDefinitions: [],
      directives: [],
      selectionSet: this._parseSelectionSet()
    };
  }
  if (token.kind === TOKEN.NAME) {
    if (token.value === 'query' || token.value === 'mutation' || token.value === 'subscription') {
      return this._parseOperationDefinition();
    }
    if (token.value === 'fragment') {
      return this._parseFragmentDefinition();
    }
  }
  throw new Error(`Unexpected token: ${token.kind} ("${token.value}")`);
};

Parser.prototype._parseOperationDefinition = function() {
  const opToken  = this.ts.next();
  const operation = opToken.value; // query | mutation | subscription
  let name = null;
  if (this.ts.peek().kind === TOKEN.NAME && this.ts.peek().value !== 'on') {
    name = this.ts.next().value;
  }
  const variableDefinitions = this._parseVariableDefinitions();
  const directives           = this._parseDirectives();
  const selectionSet         = this._parseSelectionSet();
  return { kind:'OperationDefinition', operation, name, variableDefinitions, directives, selectionSet };
};

Parser.prototype._parseFragmentDefinition = function() {
  this.ts.expectKeyword('fragment');
  const name = this.ts.expect(TOKEN.NAME).value;
  this.ts.expectKeyword('on');
  const typeCondition = this.ts.expect(TOKEN.NAME).value;
  const directives    = this._parseDirectives();
  const selectionSet  = this._parseSelectionSet();
  return { kind:'FragmentDefinition', name, typeCondition, directives, selectionSet };
};

Parser.prototype._parseVariableDefinitions = function() {
  if (this.ts.peek().kind !== TOKEN.PAREN_L) return [];
  this.ts.next(); // consume (
  const vars = [];
  while (this.ts.peek().kind !== TOKEN.PAREN_R) {
    vars.push(this._parseVariableDefinition());
  }
  this.ts.next(); // consume )
  return vars;
};

Parser.prototype._parseVariableDefinition = function() {
  this.ts.expect(TOKEN.DOLLAR);
  const variable    = this.ts.expect(TOKEN.NAME).value;
  this.ts.expect(TOKEN.COLON);
  const type        = this._parseType();
  let defaultValue  = null;
  if (this.ts.skip(TOKEN.EQUALS)) {
    defaultValue = this._parseValue(true);
  }
  return { kind:'VariableDefinition', variable, type, defaultValue };
};

Parser.prototype._parseType = function() {
  let type;
  if (this.ts.peek().kind === TOKEN.BRACKET_L) {
    this.ts.next();
    const innerType = this._parseType();
    this.ts.expect(TOKEN.BRACKET_R);
    type = { kind:'ListType', type: innerType };
  } else {
    const name = this.ts.expect(TOKEN.NAME).value;
    type = { kind:'NamedType', name };
  }
  if (this.ts.peek().kind === TOKEN.BANG) {
    this.ts.next();
    return { kind:'NonNullType', type };
  }
  return type;
};

Parser.prototype._parseSelectionSet = function() {
  this.ts.expect(TOKEN.BRACE_L);
  const selections = [];
  while (this.ts.peek().kind !== TOKEN.BRACE_R) {
    selections.push(this._parseSelection());
  }
  this.ts.expect(TOKEN.BRACE_R);
  return { kind:'SelectionSet', selections };
};

Parser.prototype._parseSelection = function() {
  if (this.ts.peek().kind === TOKEN.SPREAD) {
    return this._parseFragment();
  }
  return this._parseField();
};

Parser.prototype._parseField = function() {
  let alias = null;
  let name  = this.ts.expect(TOKEN.NAME).value;
  if (this.ts.peek().kind === TOKEN.COLON) {
    this.ts.next(); // consume :
    alias = name;
    name  = this.ts.expect(TOKEN.NAME).value;
  }
  const args         = this._parseArguments();
  const directives   = this._parseDirectives();
  let selectionSet   = null;
  if (this.ts.peek().kind === TOKEN.BRACE_L) {
    selectionSet = this._parseSelectionSet();
  }
  return { kind:'Field', alias, name, arguments: args, directives, selectionSet };
};

Parser.prototype._parseFragment = function() {
  this.ts.expect(TOKEN.SPREAD);
  if (this.ts.peek().kind === TOKEN.NAME && this.ts.peek().value === 'on') {
    this.ts.next(); // consume 'on'
    const typeCondition = this.ts.expect(TOKEN.NAME).value;
    const directives    = this._parseDirectives();
    const selectionSet  = this._parseSelectionSet();
    return { kind:'InlineFragment', typeCondition, directives, selectionSet };
  }
  const name       = this.ts.expect(TOKEN.NAME).value;
  const directives = this._parseDirectives();
  return { kind:'FragmentSpread', name, directives };
};

Parser.prototype._parseArguments = function() {
  if (this.ts.peek().kind !== TOKEN.PAREN_L) return [];
  this.ts.next(); // consume (
  const args = [];
  while (this.ts.peek().kind !== TOKEN.PAREN_R) {
    const name = this.ts.expect(TOKEN.NAME).value;
    this.ts.expect(TOKEN.COLON);
    const value = this._parseValue(false);
    args.push({ kind:'Argument', name, value });
  }
  this.ts.next(); // consume )
  return args;
};

Parser.prototype._parseValue = function(isConst) {
  const token = this.ts.peek();
  switch (token.kind) {
    case TOKEN.BRACKET_L: return this._parseListValue(isConst);
    case TOKEN.BRACE_L:   return this._parseObjectValue(isConst);
    case TOKEN.INT:    this.ts.next(); return { kind:'IntValue',    value: parseInt(token.value, 10) };
    case TOKEN.FLOAT:  this.ts.next(); return { kind:'FloatValue',  value: parseFloat(token.value) };
    case TOKEN.STRING:
    case TOKEN.BLOCK_STRING:
                       this.ts.next(); return { kind:'StringValue', value: token.value };
    case TOKEN.NAME:
      this.ts.next();
      if (token.value === 'true')  return { kind:'BooleanValue', value: true };
      if (token.value === 'false') return { kind:'BooleanValue', value: false };
      if (token.value === 'null')  return { kind:'NullValue' };
      return { kind:'EnumValue', value: token.value };
    case TOKEN.DOLLAR:
      if (!isConst) {
        this.ts.next();
        const varName = this.ts.expect(TOKEN.NAME).value;
        return { kind:'Variable', name: varName };
      }
      break;
  }
  throw new Error(`Unexpected value token: ${token.kind} ("${token.value}")`);
};

Parser.prototype._parseListValue = function(isConst) {
  this.ts.expect(TOKEN.BRACKET_L);
  const values = [];
  while (this.ts.peek().kind !== TOKEN.BRACKET_R) {
    values.push(this._parseValue(isConst));
  }
  this.ts.expect(TOKEN.BRACKET_R);
  return { kind:'ListValue', values };
};

Parser.prototype._parseObjectValue = function(isConst) {
  this.ts.expect(TOKEN.BRACE_L);
  const fields = [];
  while (this.ts.peek().kind !== TOKEN.BRACE_R) {
    const name  = this.ts.expect(TOKEN.NAME).value;
    this.ts.expect(TOKEN.COLON);
    const value = this._parseValue(isConst);
    fields.push({ name, value });
  }
  this.ts.expect(TOKEN.BRACE_R);
  return { kind:'ObjectValue', fields };
};

Parser.prototype._parseDirectives = function() {
  const directives = [];
  while (this.ts.peek().kind === TOKEN.AT) {
    this.ts.next(); // consume @
    const name = this.ts.expect(TOKEN.NAME).value;
    const args = this._parseArguments();
    directives.push({ kind:'Directive', name, arguments: args });
  }
  return directives;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * parse(source)  →  Document AST  |  throws on syntax error
 */
function parse(source) {
  return new Parser(source).parse();
}

/**
 * getArgumentValue(args, name)
 * Helper: extract a named argument value from a Field's arguments array.
 */
function getArgumentValue(args, name) {
  const arg = args.find(a => a.name === name);
  return arg ? arg.value : null;
}

/**
 * resolveValue(valueNode, variables)
 * Coerce an AST value node to a plain JS value given a variable map.
 */
function resolveValue(valueNode, variables) {
  if (!valueNode) return null;
  switch (valueNode.kind) {
    case 'IntValue':     return valueNode.value;
    case 'FloatValue':   return valueNode.value;
    case 'StringValue':  return valueNode.value;
    case 'BooleanValue': return valueNode.value;
    case 'NullValue':    return null;
    case 'EnumValue':    return valueNode.value;
    case 'Variable':     return (variables || {})[valueNode.name];
    case 'ListValue':    return valueNode.values.map(v => resolveValue(v, variables));
    case 'ObjectValue': {
      const obj = {};
      valueNode.fields.forEach(f => { obj[f.name] = resolveValue(f.value, variables); });
      return obj;
    }
  }
  return null;
}

module.exports = { parse, getArgumentValue, resolveValue, TOKEN };
