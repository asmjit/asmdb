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
const kIndexName       = 0;
const kIndexOperands   = 1;
const kIndexEncoding   = 2;
const kIndexOpcode     = 3;
const kIndexFlags      = 4;

class BaseDB {
  constructor() {
    // Maps an instruction name to an array of all Instruction instances.
    this.map = Object.create(null);

    // List of instruction names (sorted), regenerated when needed.
    this.instructionNames = null;

    // Statistics.
    this.stats = {
      insts : 0, // Number of all instructions.
      groups: 0, // Number of grouped instructions (having unique name).
    };
  }

  createInstruction(name, operands, encoding, opcode, flags) {
    throw new ("asmdb.base.BaseDB.createInstruction(): Must be reimplemented.");
  }

  updateStats(inst) {
    throw new ("asmdb.base.BaseDB.registerInstruction(): Must be reimplemented.");
  }

  addDefault() {
    throw new ("asmdb.base.BaseDB.addDefault(): Must be reimplemented.");
  }

  addInstructions(instructions) {
    for (var i = 0; i < instructions.length; i++) {
      const tuple = instructions[i];
      const names = tuple[kIndexName].split("/");

      for (var j = 0; j < names.length; j++) {
        const inst = this.createInstruction(
          names[j],
          tuple[kIndexOperands],
          tuple[kIndexEncoding],
          tuple[kIndexOpcode],
          tuple[kIndexFlags]);
        inst.postValidate();
        this.addInstruction(inst);
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
    this.updateStats(inst);

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
