// [base.js]
// AsmDB's common classes and utilities.
//
// [License]
// Public Domain.

(function($export, $as) {
"use strict";

const base = $export[$as] = {};
const hasOwn = Object.prototype.hasOwnProperty;

// Indexes used by instruction-data.
const kIndexName     = 0;
const kIndexOperands = 1;
const kIndexEncoding = 2;
const kIndexOpcode   = 3;
const kIndexMetadata = 4;

// Creates an Object without a prototype (used as a map).
function dict() { return Object.create(null); }

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
          throw new Error(`asmdb.arm.Utils.splitOperands(): Found empty operand in '${s}'`);

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
  constructor() {
    this.name = "";            // Instruction name.
    this.arch = "ANY";         // Architecture.
    this.encoding = "";        // Encoding type.

    this.implicit = false;     // Uses implicit operands (registers / memory).
    this.volatile = false;     // Has side effects and can be considered volatile.

    this.opcodeString = "";    // Instruction opcode as specified in manual.
    this.opcodeValue = 0;      // Instruction opcode as number (arch dependent).
    this.fields = dict();      // Information about each opcode field (arch dependent).

    this.cpu = dict();         // CPU features required to execute the instruction.
    this.operands = [];        // Instruction operands.
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

  createInstruction(name, operands, encoding, opcode, metadata) {
    throw new ("asmdb.base.BaseDB.createInstruction(): Must be reimplemented");
  }

  addDefault() {
    throw new ("asmdb.base.BaseDB.addDefault(): Must be reimplemented");
  }

  addInstructions(instructions) {
    for (var i = 0; i < instructions.length; i++) {
      const tuple = instructions[i];
      const names = tuple[kIndexName].split("/");

      for (var j = 0; j < names.length; j++) {
        this.addInstruction(
          this.createInstruction(
            names[j], tuple[kIndexOperands], tuple[kIndexEncoding], tuple[kIndexOpcode], tuple[kIndexMetadata]));
      }
    }

    return this;
  }

  addInstruction(inst) {
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
