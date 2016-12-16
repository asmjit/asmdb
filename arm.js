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

// Can be used to assign the number of bits each part of the opcode occupies.
// NOTE: THUMB instructions that uses halfword must always specify the width
// of all registers as many instructictions accept only LO (r0..r7) registers.
const FieldInfo = {
  "P"     : { "bits": 1 },
  "U"     : { "bits": 1 },
  "W"     : { "bits": 1 },
  "S"     : { "bits": 1 },
  "R"     : { "bits": 1 },
  "J1"    : { "bits": 1 },
  "J2"    : { "bits": 1 },
  "SOP"   : { "bits": 2 },
  "Cond"  : { "bits": 4 },
  "Cn"    : { "bits": 4 },
  "Cm"    : { "bits": 4 },
  "Rd"    : { "bits": 4, "read": false, "write": true  },
  "Rd2"   : { "bits": 4, "read": false, "write": true  },
  "RdLo"  : { "bits": 4, "read": false, "write": true  },
  "RdHi"  : { "bits": 4, "read": false, "write": true  },
  "RdList": { "bits": 4, "read": false, "write": true  , "list": true },
  "Rx"    : { "bits": 4, "read": true , "write": true  },
  "RxLo"  : { "bits": 4, "read": true , "write": true  },
  "RxHi"  : { "bits": 4, "read": true , "write": true  },
  "Rn"    : { "bits": 4, "read": true , "write": false },
  "Rm"    : { "bits": 4, "read": true , "write": false },
  "Ra"    : { "bits": 4, "read": true , "write": false },
  "Rs"    : { "bits": 4, "read": true , "write": false },
  "Rs2"   : { "bits": 4, "read": true , "write": false },
  "RsList": { "bits": 4, "read": true , "write": false , "list": true },
  "Dd"    : { "bits": 4, "read": false, "write": true  },
  "Dx"    : { "bits": 4, "read": false, "write": true  },
  "Dn"    : { "bits": 4, "read": false, "write": true  },
  "Dm"    : { "bits": 4, "read": false, "write": true  },
  "Sd"    : { "bits": 4, "read": false, "write": true  },
  "Sx"    : { "bits": 4, "read": false, "write": true  },
  "Sn"    : { "bits": 4, "read": false, "write": true  },
  "Sm"    : { "bits": 4, "read": false, "write": true  },
  "Vd"    : { "bits": 4, "read": false, "write": true  },
  "VdList": { "bits": 4, "read": false, "write": true  , "list": true },
  "Vx"    : { "bits": 4, "read": true , "write": true  },
  "Vn"    : { "bits": 4, "read": false, "write": false },
  "Vm"    : { "bits": 4, "read": false, "write": false },
  "Vs"    : { "bits": 4, "read": true , "write": false },
  "VsList": { "bits": 4, "read": true , "write": false , "list": true }
};

// ARM utilities.
class Utils {
}
arm.Utils = Utils;

function parseShiftOp(s) {
  if (/^(SOP|LSL|LSR|ASR|ROR|RRX) /.test(s))
    return s.substr(0, 3);
  else
    return "";
}

function normalizeNumber(n) {
  return n < 0 ? 0x100000000 + n : n;
}

function decomposeOperand(s) {
  var m = s.match(/==|!=|>=|<=|\*/);
  var restrict = false;

  if (m) {
    restrict = s.substr(m.index);
    s = s.substr(0, m.index);
  }

  return {
    data    : s,
    restrict: restrict
  };
}

function splitOpcodeFields(s, chars) {
  const arr = s.split("|");

  var i = 0;
  while (i < arr.length) {
    const val = arr[i];
    if (/^[0-1A-Z]{2,}$/.test(val)) {
      const subfields = val.match(/([0-1]+)|[A-Z]/g);
      arr.splice(i, 1, subfields);
      i += subfields.length;
    }
    else {
      i++;
    }
  }

  return arr;
}

// ============================================================================
// [asmdb.arm.Operand]
// ============================================================================

// ARM operand.
class Operand extends base.BaseOperand {
  constructor(def) {
    super(def);

    // --- ARM specific operand properties ---
    this.shiftOp = "";         // Operand can specify shift operation.
    this.sign = false;         // Operand (Immediate, Register, Memory) has a separate sign (+/-).

    var s = def;
    // Parse {}, which makes the operand optional.
    if (s.startsWith("{") && s.endsWith("}")) {
      this.optional = true;
      s = s.substring(1, s.length - 1);
    }

    // Parse shift operation.
    var shiftOp = parseShiftOp(s);
    if (shiftOp) {
      this.shiftOp = shiftOp;
      s = s.substring(shiftOp.length + 1);
    }

    if (s.startsWith("[")) {
      var mem = s;

      if (mem.endsWith("{!}")) {
        mem = mem.substring(0, mem.length - 3);
        // TODO: MArk.
      }
      else if (mem.endsWith("!")) {
        mem = mem.substring(0, mem.length - 1);
        // TODO: MArk.
      }

      if (!mem.endsWith("]"))
        throw new Error(`asmdb.arm.Operand(): Unknown memory operand '${mem}' in '${def}'`);

      // --- Setup memory operand ---
      this.type     = "mem";
      this.mem      = "";            // Memory operand's definition.
      this.memType  = "";            // Memory operand's type.
    }
    else if (s.startsWith("#")) {
      const obj = decomposeOperand(s);
      const imm = obj.data;

      // --- Setup immediate operand ---
      this.type     = "imm";
      this.imm      = imm;           // Immediate operand name (also representing its type).
      this.immSize  = 0;             // Immediate size in bits.
      this.restrict = obj.restrict;  // Immediate condition.
    }
    else {
      const obj = decomposeOperand(s);
      const reg = obj.data;

      const type = reg.substr(0, 1).toLowerCase();
      const info = FieldInfo[reg];

      if (!info)
        throw new Error(`asmdb.arm.Operand(): Unknown register operand '${reg}' in '${def}'`);

      // --- Setup register or register-list operand ---
      this.type     = info.list ? "reg-list" : "reg";
      this.reg      = reg;           // Register name (as specified in manual).
      this.regType  = type;          // Register type.
      this.regList  = !!info.list;   // Register list.
      this.read     = info.read;     // Register access (read).
      this.write    = info.write;    // Register access (write).
      this.restrict = obj.restrict;  // Register condition.
    }
  }

  get name() {
    switch (this.type) {
      case "reg": return this.reg;
      case "mem": return this.mem;
      case "imm": return this.imm;
      case "rel": return this.rel;
      default:
        return "";
    }
  }

  get scale() {
    if (this.restrict && this.restrict.startsWith("*"))
      return parseInt(this.restrict.substr(1), 10);
    else
      return 0;
  }
}
arm.Operand = Operand;

// ============================================================================
// [asmdb.arm.Instruction]
// ============================================================================

// ARM instruction.
class Instruction extends base.BaseInstruction {
  constructor(name, operands, encoding, opcode, metadata) {
    super();
    this.assignData(name, operands, encoding, opcode, metadata);
  }

  assignData(name, operands, encoding, opcode, metadata) {
    this.name = name;

    this.assignOperands(operands);
    this.assignEncoding(encoding);
    this.assignOpcode(opcode);
    this.assignMetadata(metadata);
  }

  assignEncoding(s) {
    // Instruction encoding describes also the target architecture (THUMB|A32|A64):
    this.arch = s === "T16" || s === "T32" ? "THUMB" : s;
    this.encoding = s;
  }

  assignOperands(s) {
    if (!s) return;

    // Split into individual operands and push them to `operands`.
    const arr = base.Parsing.splitOperands(s);
    for (var i = 0; i < arr.length; i++) {
      const opstr = arr[i].trim();
      const operand = new Operand(opstr);

      this.operands.push(operand);
    }
  }

  assignOpcode(s) {
    this.opcodeString = s;

    var opcodeIndex = 0;
    var opcodeValue = 0;

    // Split opcode into its fields.
    const arr = splitOpcodeFields(s);
    const fields = this.fields;

    for (var i = arr.length - 1; i >= 0; i--) {
      var key = arr[i].trim();
      var m;

      if (/^[0-1]+$/.test(key)) {
        // This part of the opcode is RAW bits, they contribute to the `opcodeValue`.
        opcodeValue |= parseInt(key, 2) << opcodeIndex;
        opcodeIndex += key.length;
      }
      else {
        var size = 0;
        var mask = 0;
        var bits = 0;

        const lbit = key.startsWith("'");
        const hbit = key.endsWith("'");

        if (lbit) key = key.substring(1);
        if (hbit) key = key.substring(0, key.length - 1);

        if ((m = key.match(/\[\s*(\d+)\s*\:\s*(\d+)\s*\]$/))) {
          const a = parseInt(m[1], 10);
          const b = parseInt(m[2], 10);
          if (a < b)
            throw new Error(`asmdb.arm.Instruction.assignOpcode(): Invalid bit range '${key}' in opcode '${s}'`);
          size = a - b + 1;
          mask = ((1 << size) - 1) << b;
          key = key.substr(0, m.index).trim();
        }
        else if ((m = key.match(/\[\s*(\d+)\s*\]$/))) {
          const ab = parseInt(m[1], 10);
          size = 1;
          mask = 1 << ab;
          key = key.substr(0, m.index).trim();
        }
        else if ((m = key.match(/\:\s*(\d+)$/))) {
          size = parseInt(m[1], 10);
          bits = size;
          key = key.substr(0, m.index).trim();
        }
        else if (FieldInfo[key]) {
          // Sizes of some standard fields can be assigned automatically.
          size = FieldInfo[key].bits;
          bits = size;
        }
        else {
          throw new Error(`asmdb.arm.Instruction.assignOpcode(): Cannot recognize the size of '${key}' in opcode '${s}'`);
        }

        const field = fields[key] || (fields[key] = {
          index: opcodeIndex,
          bits: 0,
          mask: 0,
          hbit: 0 // Only 1 if a single quote (') was used.
        });

        field.mask |= mask;
        field.bits += bits;
        field.lbit += lbit;
        field.hbit += hbit;

        opcodeIndex += size;
      }
    }

    // Normalize all fields.
    for (var key in fields) {
      const field = fields[key];

      // There should be either number of bits or mask, there shouldn't be both.
      if (!field.bits && !field.mask)
        throw new Error(`asmdb.arm.Instruction.assignOpcode(): Part '${key}' of opcode '${s}' contains neither size nor mask`);

      if (field.bits && field.mask)
        throw new Error(`asmdb.arm.Instruction.assignOpcode(): Part '${key}' of opcode '${s}' contains both size and mask`);

      if (field.bits)
        field.mask = ((1 << field.bits) - 1);
      else if (field.mask)
        field.bits = 32 - Math.clz32(field.mask);

      // Handle field that used single-quote.
      if (field.lbit) {
        field.mask = (field.mask << 1) | 0x1;
        field.bits++;
      }

      if (field.hbit) {
        field.mask |= 1 << field.bits;
        field.bits++;
      }

      const op = this.getOperandByName(key);
      if (op && op.isImm()) op.immSize = field.bits;
    }

    // Check if the opcode value has the correct number of bits (either 16 or 32).
    if (opcodeIndex !== 16 && opcodeIndex !== 32)
      throw new Error(`asmdb.arm.Instruction.assignOpcode(): The number of bits '${opcodeIndex}' used by the opcode '${s}' doesn't match 16 or 32`);
    this.opcodeValue = normalizeNumber(opcodeValue);
  }

  assignMetadata(metadata) {

  }

  getOperandByName(name) {
    const operands = this.operands;
    for (var i = 0; i < operands.length; i++) {
      const op = operands[i];
      if (op.name === name)
        return op;
    }
    return null;
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

  createInstruction(name, operands, encoding, opcode, metadata) {
    return new Instruction(name, operands, encoding, opcode, metadata);
  }

  addDefault() {
    this.addInstructions(armdata.instructions);
    return this;
  }
}
arm.DB = DB;

}).apply(this, typeof module === "object" && module && module.exports
  ? [module, "exports"] : [this.asmdb || (this.asmdb = {}), "arm"]);
