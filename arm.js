// [arm.js]
// ARM instruction-set utilities that use `armdata.js`.
//
// [License]
// Public Domain.

(function($scope, $as) {
"use strict";

function FAIL(msg) { throw new Error("[ARM] " + msg); }

// Import.
const base = $scope.base ? $scope.base : require("./base.js");
const armdata = $scope.armdata ? $scope.armdata : require("./armdata.js");

const hasOwn = Object.prototype.hasOwnProperty;
const dict = base.dict;
const NONE = base.NONE;
const Parsing = base.Parsing;

// Export.
const arm = $scope[$as] = dict();

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
  "Ja"    : { "bits": 1 },
  "Jb"    : { "bits": 1 },
  "Op"    : { "bits": 1 }, // TODO: This should be fixed.
  "Sz"    : { "bits": 2 },
  "Sop"   : { "bits": 2 },
  "Cond"  : { "bits": 4 },
  "CMode" : { "bits": 4 },
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
  "Sd"    : { "bits": 4, "read": false, "write": true  },
  "Sd2"   : { "bits": 4, "read": false, "write": true  },
  "Sx"    : { "bits": 4, "read": false, "write": true  },
  "Sn"    : { "bits": 4, "read": false, "write": true  },
  "Sm"    : { "bits": 4, "read": false, "write": true  },
  "Ss"    : { "bits": 4, "read": false, "write": true  },
  "Ss2"   : { "bits": 4, "read": false, "write": true  },
  "Dd"    : { "bits": 4, "read": false, "write": true  },
  "Dx"    : { "bits": 4, "read": false, "write": true  },
  "Dx2"   : { "bits": 4, "read": false, "write": true  },
  "Dn"    : { "bits": 4, "read": false, "write": true  },
  "Dn2"   : { "bits": 4, "read": false, "write": true  },
  "Dn3"   : { "bits": 4, "read": false, "write": true  },
  "Dn4"   : { "bits": 4, "read": false, "write": true  },
  "Dm"    : { "bits": 4, "read": false, "write": true  },
  "Ds"    : { "bits": 4, "read": false, "write": true  },
  "Vd"    : { "bits": 4, "read": false, "write": true  },
  "Vd2"   : { "bits": 4, "read": false, "write": true  },
  "VdList": { "bits": 4, "read": false, "write": true  , "list": true },
  "Vx"    : { "bits": 4, "read": true , "write": true  },
  "Vx2"   : { "bits": 4, "read": true , "write": true  },
  "Vn"    : { "bits": 4, "read": false, "write": false },
  "Vm"    : { "bits": 4, "read": false, "write": false },
  "Vs"    : { "bits": 4, "read": true , "write": false },
  "Vs2"   : { "bits": 4, "read": true , "write": false },
  "VsList": { "bits": 4, "read": true , "write": false , "list": true }
};

// ARM utilities.
class Utils {
  static parseShiftOp(s) {
    if (/^(?:Sop|LSL|LSR|ASR|ROR|RRX) /.test(s))
      return s.substr(0, 3);
    else
      return "";
  }

  static parseDtArray(s) {
    const out = [];
    if (!s) return out;

    const arr = s.split("|");
    var i;

    // First expand anything between X-Y, for example s8-32 would be expanded to [s8, s16, s32].
    for (i = 0; i < arr.length; i++) {
      const v = arr[i];

      if (v.indexOf("-") !== -1) {
        const m = /^([A-Za-z]+)(\d+)-(\d+)$/.exec("r16-32");
        if (!m)
          FAIL(`Couldn't parse '${s}' data-type`);

        var type = m[1];
        var size = parseInt(m[2], 10);
        var last = parseInt(m[3], 10);

        if (!Utils.checkDtSize(size) || !Utils.checkDtSize(last))
          FAIL(`Invalid dt width in '${s}'`);

        do {
          out.push(type + String(size));
          size <<= 1;
        } while (size <= last);
      }
      else {
        out.push(v);
      }
    }

    // Now expand 'x' to 's' and 'u'.
    i = 0;
    while (i < out.length) {
      const v = out[i];
      if (v.startsWith("x")) {
        out.splice(i, 1, "s" + v.substr(1), "u" + v.substr(1));
        i += 2;
      }
      else {
        i++;
      }
    }

    return out;
  }

  static checkDtSize(x) {
    return x === 8 || x === 16 || x === 32 || x === 64;
  }
}
arm.Utils = Utils;

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

function splitOpcodeFields(s) {
  const arr = s.split("|");
  const out = [];

  for (var i = 0; i < arr.length; i++) {
    const val = arr[i];
    if (/^[0-1A-Z]{2,}$/.test(val))
      out.push.apply(out, val.match(/([0-1]+)|[A-Z]/g));
    else
      out.push(val);
  }

  return out;
}

// ============================================================================
// [asmdb.arm.Operand]
// ============================================================================

// ARM operand.
class Operand extends base.Operand {
  constructor(def) {
    super(def);

    // --- ARM specific operand properties ---
    this.shiftOp = "";         // Operand can specify shift operation.
    this.sign = false;         // Operand (Immediate, Register, Memory) has a separate sign (+/-).

    var s = def;

    // Handle {optional} attribute.
    if (Parsing.isOptional(s)) {
      this.optional = true;
      s = Parsing.clearOptional(s);
    }

    // Handle commutativity <-> symbol.
    if (Parsing.isCommutative(s)) {
      this.commutative = true;
      s = Parsing.clearCommutative(s);
    }

    // Handle shift operation.
    var shiftOp = Utils.parseShiftOp(s);
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
        FAIL(`Unknown memory operand '${mem}' in '${def}'`);

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
        FAIL(`Unknown register operand '${reg}' in '${def}'`);

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
      default   : return "";
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
class Instruction extends base.Instruction {
  constructor(db, name, operands, encoding, opcode, metadata) {
    super(db);

    this.name = name;
    this.s = null;                   // Instruction S flag (null, true, or false).
    this.dt = [];                    // Instruction <dt> field (first data-type).
    this.dt2 = [];                   // Instruction <dt2> field (second data-type).

    this.availableFrom  = "";        // Instruction supported by from  ARMv???.
    this.availableUntil = "";        // Instruction supported by until ARMv???.

    this._assignOperands(operands);
    this._assignEncoding(encoding);
    this._assignOpcode(opcode);
    this._assignMetadata(metadata);

    this._updateOperandsInfo();
    this._postProcess();
  }

  // ARM encoding specifies whether the instruction is:
  //   - T16 (16-bit THUMB)
  //   - T32 (32-bit THUMB2)
  //   - A32 (AArch32 / ARM)
  //   - A64 (AArch64)
  _assignEncoding(s) {
    this.arch = s === "T16" || s === "T32" ? "THUMB" : s;
    this.encoding = s;
  }

  _assignOperands(s) {
    if (!s) return;

    // Split into individual operands and push them to `operands`.
    const arr = base.Parsing.splitOperands(s);
    for (var i = 0; i < arr.length; i++) {
      this.operands.push(new Operand(arr[i].trim()));
    }
  }

  _assignOpcode(s) {
    this.opcodeString = s;

    var opcodeIndex = 0;
    var opcodeValue = 0;

    // Split opcode into its fields.
    const arr = splitOpcodeFields(s);
    const dup = dict();

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

        var lbit = key.startsWith("'");
        var hbit = key.endsWith("'");

        if ((m = key.match(/\[\s*(\d+)\s*\:\s*(\d+)\s*\]$/))) {
          const a = parseInt(m[1], 10);
          const b = parseInt(m[2], 10);
          if (a < b)
            FAIL(`Invalid bit range '${key}' in opcode '${s}'`);
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
        else {
          const key_ = key;

          if (lbit || hbit) {
            if (lbit && hbit)
              FAIL(`Couldn't recognize the format of '${key}' in opcode '${s}'`);

            if (lbit) key = key.substring(1);
            if (hbit) key = key.substring(0, key.length - 1);

            size = 1;
          }
          else if (FieldInfo[key]) {
            // Sizes of some standard fields can be assigned automatically.
            size = FieldInfo[key].bits;
            bits = size;
          }
          else if (key.length === 1) {
            // Sizes of one-letter fields (like 'U', 'F', etc...) is 1 if not specified.
            size = 1;
            bits = 1;
          }
          else {
            FAIL(`Couldn't recognize the size of '${key}' in opcode '${s}'`);
          }

          if (dup[key_] === true) {
            bits = 0;
            lbit = 0;
            hbit = 0;
          }
          else {
            dup[key_] = true;
          }
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
        FAIL(`Part '${key}' of opcode '${s}' contains neither size nor mask`);

      if (field.bits && field.mask)
        FAIL(`Part '${key}' of opcode '${s}' contains both size and mask`);

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
      FAIL(`The number of bits '${opcodeIndex}' used by the opcode '${s}' doesn't match 16 or 32`);
    this.opcodeValue = normalizeNumber(opcodeValue);
  }

  _assignSpecificAttribute(key, value) {
    // Support ARMv?+ and ARMv?- attributes.
    if (/^ARM\w+[+-]$/.test(key)) {
      const armv = key.substr(0, key.length - 1);
      const sign = key.substr(key.length - 1);

      if (sign === "+")
        this.availableFrom = armv;
      else
        this.availableUntil = armv;
      return true;
    }

    switch (key) {
      case "IT": {
        const values = String(value).split("|");
        for (var i = 0; i < values.length; i++) {
          const value = values[i];
          switch (value) {
            case "IN"  : this.attributes.IT_IN   = true; break;
            case "OUT" : this.attributes.IT_OUT  = true; break;
            case "ANY" : this.attributes.IT_IN   = true;
                         this.attributes.IT_OUT  = true; break;
            case "LAST": this.attributes.IT_LAST = true; break;
            case "DEF" : this.attributes.IT_DEF  = true; break;
            default:
              this.report(`${this.name}: Unhandled IT value '${value}'`);
          }
        }
        return true;
      }
    }

    return false;
  }

  // ARM instruction name could consist of name and optional type information
  // specified as <dt> and <dt2> in ARM manuals. We parse this information and
  // store it to `dt` and `dt2` fields. In addition, we also recognize the `S`
  // suffix (uppercase) of the instruction and mark it as `S` instruction. After
  // that the name is normalized to be lowercased.
  //
  // This functionality requires all the instruction data to be already set-up.
  _postProcess() {
    var s = this.name;

    // Parse <dt> and <dt2> fields.
    if (s.indexOf(".") !== -1) {
      const parts = s.split(".");
      this.name = parts[0];

      if (parts.length > 3)
        FAIL(`Couldn't recognize name attributes of '${s}'`);

      for (var i = 1; i < parts.length; i++) {
        const dt = Utils.parseDtArray(parts[i]);
        if (i === 1)
          this.dt = dt;
        else
          this.dt2 = dt;
      }
    }

    // Recognize "S" suffix.
    if (this.name.endsWith("S")) {
      this.name = this.name.substr(0, this.name.length - 1) + "s";
      this.s = true;
    }
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
// [asmdb.arm.ISA]
// ============================================================================

class ISA extends base.ISA {
  constructor(args) {
    super(args);

    if (!args)
      args = NONE;

    if (args.builtins !== false)
      this.addData(armdata);

    this.addData(args);
  }

  _createInstruction(name, operands, encoding, opcode, metadata) {
    return new Instruction(this, name, operands, encoding, opcode, metadata);
  }
}
arm.ISA = ISA;

}).apply(this, typeof module === "object" && module && module.exports
  ? [module, "exports"] : [this.asmdb || (this.asmdb = {}), "arm"]);
