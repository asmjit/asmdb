// [base.js]
// AsmDB's common classes and utilities.
//
// [License]
// Public Domain.

(function($export, $as) {
"use strict";

const base = $export[$as] = {};
const hasOwn = Object.prototype.hasOwnProperty;

// Creates an Object without a prototype (used as a map).
function dict() { return Object.create(null); }

// If something failed...
function fail(msg) { throw new Error("[BASE] " + msg); }

// Replaces default arguments object (if not provided).
const NoObject = Object.freeze({});

// Indexes used by instruction-data.
const kIndexName     = 0;
const kIndexOperands = 1;
const kIndexEncoding = 2;
const kIndexOpcode   = 3;
const kIndexMetadata = 4;

// ============================================================================
// [asmdb.base.Parsing]
// ============================================================================

// Namespace that provides functions related to text parsing.
class Parsing {
  // Matches a closing bracket in string `s` starting `from` the given index.
  // It behaves like `s.indexOf()`, but uses a counter and skips all nested
  // matches.
  static matchClosingChar(s, from) {
    const opening = s.charCodeAt(from);
    const closing = opening === 40  ? 31  :    // ().
                    opening === 60  ? 62  :    // <>.
                    opening === 91  ? 93  :    // [].
                    opening === 123 ? 125 : 0; // {}.

    const len = s.length;

    var i = from;
    var pending = 1;

    do {
      if (++i >= len)
        break;

      const c = s.charCodeAt(i);
      pending += Number(c === opening);
      pending -= Number(c === closing);
    } while (pending);

    return i;
  }

  // Split instruction operands into an array containing each operand as a
  // trimmed string. This function is similar to `s.split(",")`, however,
  // it matches brackets inside the operands and won't just blindly split
  // the string based on "," token. If operand contains metadata or it's
  // an address it would still be split correctly.
  static splitOperands(s) {
    const result = [];

    s = s.trim();
    if (!s) return result;

    var start = 0;
    var i = 0;
    var c = "";

    for (;;) {
      if (i === s.length || (c = s[i]) === ",") {
        const op = s.substring(start, i).trim();
        if (!op)
          fail(`Found empty operand in '${s}'`);

        result.push(op);
        if (i === s.length)
          return result;

        start = ++i;
        continue;
      }

      if (c === "[" || c === "{" || c === "(" || c === "<")
        i = base.Parsing.matchClosingChar(s, i);
      else
        i++;
    }
  }
}
base.Parsing = Parsing;

// ============================================================================
// [asmdb.base.BaseOperand]
// ============================================================================

class BaseOperand {
  constructor(def) {
    this.type     = "";        // Type of the operand ("reg", "mem", "reg/mem", "imm", "rel").
    this.data     = def;       // The operand's data (possibly processed).
    this.optional = false;     // Operand is {optional} (only immediates, zero in such case).
    this.implicit = false;     // True if the operand is implicit.
    this.restrict = "";        // Operand is restricted (specific register or immediate value).
    this.read     = false;     // True if the operand is a read-op from reg/mem.
    this.write    = false;     // True if the operand is a write-op to reg/mem.
  }

  isReg() { return this.type === "reg" || this.type === "reg/mem"; }
  isMem() { return this.type === "mem" || this.type === "reg/mem"; }
  isImm() { return this.type === "imm"; }
  isRel() { return this.type === "rel"; }

  isRegMem() { return this.type === "reg/mem"; }
  isRegList() { return this.type === "reg-list" }

  toString() { return this.data; }
}
base.BaseOperand = BaseOperand;

// ============================================================================
// [asmdb.base.BaseInstruction]
// ============================================================================

// Defines interface and properties that each architecture dependent instruction
// must provide even if that particular architecture doesn't use that feature(s).
class BaseInstruction {
  constructor(db) {
    Object.defineProperty(this, "db", { value: db });

    this.name = "";            // Instruction name.
    this.arch = "ANY";         // Architecture.
    this.encoding = "";        // Encoding type.

    this.implicit = false;     // Uses implicit operands (registers / memory).

    this.opcodeString = "";    // Instruction opcode as specified in manual.
    this.opcodeValue = 0;      // Instruction opcode as number (arch dependent).
    this.fields = dict();      // Information about each opcode field (arch dependent).
    this.extensions = dict();  // Extensions required by the instruction.
    this.attributes = dict();  // Instruction attributes from metadata & opcode.
    this.specialRegs = dict(); // Information about read/write to special registers.

    this.operands = [];        // Instruction operands.
  }

  _assignMetadata(s) {
    // Split into individual attributes (separated by spaces).
    const attributes = s.trim().split(/[ ]+/);
    const shortcuts = this.db.shortcuts;

    for (var i = 0; i < attributes.length; i++) {
      const attr = attributes[i].trim();
      if (!attr) continue;

      const eq = attr.indexOf("=");
      var key = eq === -1 ? attr   : attr.substr(0, eq);
      var val = eq === -1 ? "TRUE" : attr.substr(eq + 1);

      // apply shortcut, if defined.
      const shortcut = shortcuts[key];
      if (shortcut)
        key = shortcut.expand;

      // If the key contains "|" it's a definition of multiple attributes.
      if (key.indexOf("|") !== -1) {
        const dot = key.indexOf(".");

        const base = dot === -1 ? "" : key.substr(0, dot + 1);
        const keys = (dot === -1 ? key : key.substr(dot + 1)).split("|");

        for (var i = 0; i < keys.length; i++)
          this._assignAttribute(base + keys[i], val);
        return;
      }

      this._assignAttribute(key, val);
    }
  }

  _assignAttribute(key, value) {
    if (this._assignSimpleAttribute(key, value))
      return;

    if (this._assignSpecificAttribute(key, value))
      return;

    this.report(`Unhandled flag ${key}=${value}`);
  }

  _assignSimpleAttribute(key, value) {
    const db = this.db;

    const extensionDef = db.extensions[key];
    if (extensionDef) {
      this.extensions[key] = true;
      return true;
    }

    const attributeDef = db.attributes[key];
    if (attributeDef) {
      switch (attributeDef.type) {
        case "flag":
          value = String(value).toUpperCase() === "TRUE" ? true : false;
          break;

        case "string":
          value = String(value);
          break;

        case "string[]":
          value = String(value).split("|");
          break;

        default:
          fail(`Unknown attribute type ${attributeDef.type}`);
      }

      this.attributes[key] = value;
      return true;
    }

    if (db.specialRegs[key]) {
      if (typeof value !== "string" || !/^[RWXU01]$/.test(value))
        this.report(`Special registers must contain 'R|W|X|U|0|1', not ${value}`);

      this.specialRegs[key] = value;
      return true;
    }

    return false;
  }

  _assignSpecificAttribute(key, value) {
    return false;
  }

  report(msg) {
    console.log(`${this}: ${msg}`);
  }

  toString() {
    return `${this.name} ${this.operands.join(", ")}`;
  }
}
base.BaseInstruction = BaseInstruction;

// ============================================================================
// [asmdb.base.BaseDB]
// ============================================================================

class BaseDB {
  constructor() {
    this._cpuLevels = dict();
    this._extensions = dict();
    this._attributes = dict();
    this._specialRegs = dict();
    this._shortcuts = dict();

    // Maps an instruction name to an array of all Instruction instances.
    this.map = Object.create(null);

    // List of instruction names (sorted), regenerated when needed.
    this.instructionNames = null;

    // Statistics.
    this.stats = {
      insts : 0, // Number of all instructions.
      groups: 0  // Number of grouped instructions (having unique name).
    };
  }

  get cpuLevels() { return this._cpuLevels; }
  get extensions() { return this._extensions; }
  get attributes() { return this._attributes; }
  get specialRegs() { return this._specialRegs; }
  get shortcuts() { return this._shortcuts; }

  _createInstruction(name, operands, encoding, opcode, metadata) {
    fail("Abstract method called");
  }

  addDefault() {
    fail("DB.addDefault() - Instructions are added by default, use new DB({ builtins: false }) to turn this feature off");
  }

  addData(data) {
    if (typeof data !== "object" || !data)
      fail("Data must be object");

    if (data.cpuLevels) this._addCpuLevels(data.cpuLevels);
    if (data.extensions) this._addExtensions(data.extensions);
    if (data.attributes) this._addAttributes(data.attributes);
    if (data.specialRegs) this._addSpecialRegs(data.specialRegs);
    if (data.shortcuts) this._addShortcuts(data.shortcuts);
    if (data.instructions) this._addInstructions(data.instructions);
  }

  _addCpuLevels(items) {
    if (!Array.isArray(items))
      fail("Property 'cpuLevels' must be array");

    for (var i = 0; i < items.length; i++) {
      const item = items[i];
      const name = item.name;

      const obj = {
        name: name
      };

      this._cpuLevels[name] = obj;
    }
  }

  _addExtensions(items) {
    if (!Array.isArray(items))
      fail("Property 'extensions' must be array");

    for (var i = 0; i < items.length; i++) {
      const item = items[i];
      const name = item.name;

      const obj = {
        name: name,
        from: item.from || ""
      };

      this._extensions[name] = obj;
    }
  }

  _addAttributes(items) {
    if (!Array.isArray(items))
      fail("Property 'attributes' must be array");

    for (var i = 0; i < items.length; i++) {
      const item = items[i];
      const name = item.name;
      const type = item.type;

      if (!/^(?:flag|string|string\[\])$/.test(type))
        fail(`Unknown attribute type '${type}'`);

      const obj = {
        name: name,
        type: type,
        doc : item.doc || ""
      };

      this._attributes[name] = obj;
    }
  }

  _addSpecialRegs(items) {
    if (!Array.isArray(items))
      fail("Property 'specialRegs' must be array");

    for (var i = 0; i < items.length; i++) {
      const item = items[i];
      const name = item.name;

      const obj = {
        name: name,
        doc : item.doc || ""
      };

      this._specialRegs[name] = obj;
    }
  }

  _addShortcuts(items) {
    if (!Array.isArray(items))
      fail("Property 'shortcuts' must be array");

    for (var i = 0; i < items.length; i++) {
      const item = items[i];
      const name = item.name;

      const obj = {
        name: name,
        doc : item.doc || ""
      };

      this._specialRegs[name] = obj;
    }
  }

  _addInstructions(instructions) {
    for (var i = 0; i < instructions.length; i++) {
      const tuple = instructions[i];
      const names = tuple[kIndexName].split("/");

      for (var j = 0; j < names.length; j++) {
        this._addInstruction(
          this._createInstruction(
            names[j], tuple[kIndexOperands], tuple[kIndexEncoding], tuple[kIndexOpcode], tuple[kIndexMetadata]));
      }
    }

    return this;
  }

  _addInstruction(inst) {
    var group;

    if (hasOwn.call(this.map, inst.name)) {
      group = this.map[inst.name];
    }
    else {
      group = this.map[inst.name] = [];
      this.instructionNames = null;
      this.stats.groups++;
    }

    group.push(inst);
    this.stats.insts++;

    return this;
  }

  getGroup(name) {
    return this.map[name] || null;
  }

  getInstructionNames() {
    const map = this.map;

    var names = this.instructionNames;
    if (names === null) {
      names = Object.keys(map);
      names.sort();
      this.instructionNames = names;
    }

    return names;
  }

  forEach(cb, thisArg) {
    const map = this.map;
    const names = this.getInstructionNames();

    for (var i = 0; i < names.length; i++) {
      const name = names[i];
      const list = map[name];

      for (var j = 0; j < list.length; j++)
        cb.call(thisArg, name, list[j]);
    }

    return this;
  }

  forEachGroup(cb, thisArg) {
    const map = this.map;
    const names = this.getInstructionNames();

    for (var i = 0; i < names.length; i++) {
      const name = names[i];
      cb.call(thisArg, name, map[name]);
    }

    return this;
  }
}
base.BaseDB = BaseDB;

}).apply(this, typeof module === "object" && module && module.exports
  ? [module, "exports"] : [this.asmdb || (this.asmdb = {}), "base"]);
