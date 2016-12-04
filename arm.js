// [arm.js]
// ARM instruction-set utilities that use `armdata.js`.
//
// [License]
// Public Domain.

(function($export, $as) {
"use strict";

const arm = $export[$as] = {};
const base = $export.armdata ? $export.base : require("./base.js");
const armdata = $export.armdata ? $export.armdata : require("./armdata.js");

// Creates an Object without a prototype (used as a map).
function dict() { return Object.create(null); }

// ============================================================================
// [asmdb.arm.Utils]
// ============================================================================

// ARM utilities.
class Utils {
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
          throw new Error(`asmdb.arm.Utils.splitOperands(): Found empty operand in '${s}'.`);

        result.push(op);
        if (i === s.length)
          return result;

        start = ++i;
        continue;
      }

      if (c === "[") {
        i = s.indexOf("]", i);
        if (i === -1) i = s.length;
      }
      else {
        i++;
      }
    }
  }
}
arm.Utils = Utils;

// ============================================================================
// [asmdb.arm.Operand]
// ============================================================================

// ARM operand.
class Operand {
  constructor(data, defaultAccess) {
    this.data = data;       // The operand's data (possibly processed).
    this.type = "";         // Type of the operand.

    this.read = false;      // True if the operand is a read-op (R or X) from reg/mem.
    this.write = false;     // True if the operand is a write-op (W or X) to reg/mem.
    this.sign = false;      // Operand (Immediate, Register, Memory) has a separate sign (+/-).
    this.optional = false;  // Operand is {optional} (only immediates, zero in such case).

    this.reg = "";          // Register operand's definition.
    this.regType = "";      // Register operand's type.

    this.mem = "";          // Memory operand's definition.
    this.memType = "";      // Memory operand's type.

    this.imm = 0;           // Immediate operand's size (in bits).
    this.immType = "";      // Immediate type and/or name.

    if (data.startsWith("{") && data.endsWith("}")) {
      data = data.substring(1, data.length - 1);
      this.optional = true;
    }

    var type = "";
    if (data.startsWith("[")) {
      type = "mem";

      var mem = data;

      if (mem.endsWith("{!}")) {
        mem = mem.substr(0, mem.length - 3);
      }
      else if (mem.endsWith("!")) {
        mem = mem.substr(0, mem.length - 1);
      }

      if (!mem.endsWith("]"))
        throw new Error(`asmdb.arm.Operand(): Unknown memory operand '${data}'.`);

    }
    else if (data.startsWith("#")) {
      type = "imm";

      var imm = data.substr(1);
      const immBits = imm.match(/\d+$/);

      this.immType = imm;
      this.imm = immBits ? parseInt(immBits[0], 10) : 0;
    }
    else {
      type = "reg";

      this.reg = data;
      this.regType = data.substr(0, 1).toLowerCase();
    }

    this.data = data;
    this.type = type;
  }

  isReg() { return !!this.reg; }
  isMem() { return !!this.mem; }
  isImm() { return !!this.imm; }
  isRel() { return !!this.rel; }
  isRegOrMem() { return !!this.reg || !!this.mem; }

  toString() { return this.data; }
}
arm.Operand = Operand;

// ============================================================================
// [asmdb.arm.Instruction]
// ============================================================================

// ARM instruction.
class Instruction {
  constructor(name, operands, encoding, opcode, flags) {
    // We use table encoding as arch as it's always one of T16/T32/A16/A64, which
    // describes how the instruction is encoded and also the processor mode it
    // requires to run. The encoding field will be expanded accordingly to the
    // opcode value.

    this.name = name;         // Instruction name.
    this.arch = encoding;     // Architecture - T16/T32/A32/A64.
    this.encoding = "";       // Instruction encoding.

    this.opcodeString = "";   // The whole opcode string, as specified in manual.

    this.implicit = false;    // Uses implicit operands (registers / memory).
    this.volatile = false;    // Volatile instruction hint for the instruction scheduler.

    this.cpu = dict();        // CPU features required to execute the instruction.
    this.operands = [];       // Instruction operands array.

    this.assignOperands(operands);
    this.assignOpcode(opcode);
    //this.assignEncoding(encoding);

    //this.assignOpcode(opcode);
    //this.assignFlags(flags);
  }

  assignOperands(s) {
    if (!s) return;

    // Split into individual operands and push them to `operands`.
    var parts = Utils.splitOperands(s);
    for (var i = 0; i < parts.length; i++) {
      var data = parts[i];
      var operand = new Operand(data);

      this.operands.push(operand);
    }
  }

  assignOpcode(s) {
    this.opcodeString = s;
  }

  postValidate() {
  }

  toString() {
    return `${this.name} ${this.operands.join(", ")}`;
  }
}
arm.Instruction = Instruction;

// ============================================================================
// [asmdb.arm.DB]
// ============================================================================

class DB extends base.BaseDB {
  constructor() {
    super();
  }

  createInstruction(name, operands, encoding, opcode, flags) {
    return new Instruction(name, operands, encoding, opcode, flags);
  }

  updateStats(inst) {
    return this;
  }

  addDefault() {
    this.addInstructions(armdata.instructions);
    return this;
  }
}
arm.DB = DB;

}).apply(this, typeof module === "object" && module && module.exports
  ? [module, "exports"] : [this.asmdb || (this.asmdb = {}), "arm"]);
