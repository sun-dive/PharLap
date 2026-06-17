"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key2, value) => key2 in obj ? __defProp(obj, key2, { enumerable: true, configurable: true, writable: true, value }) : obj[key2] = value;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __publicField = (obj, key2, value) => __defNormalProp(obj, typeof key2 !== "symbol" ? key2 + "" : key2, value);

  // node_modules/@bsv/sdk/dist/esm/src/primitives/BigNumber.js
  var BufferCtor = typeof globalThis === "undefined" ? void 0 : globalThis.Buffer;
  var CAN_USE_BUFFER = BufferCtor != null && typeof BufferCtor.from === "function";
  var HEX_CHAR_TO_VALUE = new Int8Array(256).fill(-1);
  for (let i = 0; i < 10; i++) {
    HEX_CHAR_TO_VALUE[48 + i] = i;
  }
  for (let i = 0; i < 6; i++) {
    HEX_CHAR_TO_VALUE[65 + i] = 10 + i;
    HEX_CHAR_TO_VALUE[97 + i] = 10 + i;
  }
  var _BigNumber = class _BigNumber {
    /**
     * @constructor
     *
     * @param number - The number (various types accepted) to construct a BigNumber from. Default is 0.
     * @param base - The base of number provided. By default is 10.
     * @param endian - The endianness provided. By default is 'big endian'.
     */
    constructor(number = 0, base = 10, endian = "be") {
      __publicField(this, "_magnitude", 0n);
      __publicField(this, "_sign", 0);
      __publicField(this, "_nominalWordLength", 1);
      /**
       * Reduction context of the big number.
       *
       * @property red
       */
      __publicField(this, "red");
      this.red = null;
      number ?? (number = 0);
      if (number === null) {
        this._initializeState(0n, 0);
        return;
      }
      if (typeof number === "bigint") {
        this._initializeState(number < 0n ? -number : number, number < 0n ? 1 : 0);
        this.normSign();
        return;
      }
      let effectiveBase = base;
      let effectiveEndian = endian;
      if (base === "le" || base === "be") {
        effectiveEndian = base;
        effectiveBase = 10;
      }
      if (typeof number === "number") {
        this.initNumber(number, effectiveEndian);
        return;
      }
      if (Array.isArray(number)) {
        this.initArray(number, effectiveEndian);
        return;
      }
      if (typeof number === "string") {
        this._initFromString(number, effectiveBase, effectiveEndian);
        return;
      }
      if (number !== 0) {
        this.assert(false, "Unsupported input type for BigNumber constructor");
      } else {
        this._initializeState(0n, 0);
      }
    }
    /**
     * Negative flag. Indicates whether the big number is a negative number.
     * - If 0, the number is positive.
     * - If 1, the number is negative.
     *
     * @property negative
     */
    get negative() {
      return this._sign;
    }
    /**
     * Sets the negative flag. Only 0 (positive) or 1 (negative) are allowed.
     */
    set negative(val2) {
      this.assert(val2 === 0 || val2 === 1, "Negative property must be 0 or 1");
      const newSign = val2 === 1 ? 1 : 0;
      if (this._magnitude === 0n) {
        this._sign = 0;
      } else {
        this._sign = newSign;
      }
    }
    get _computedWordsArray() {
      if (this._magnitude === 0n)
        return [0];
      const arr = [];
      let temp = this._magnitude;
      while (temp > 0n) {
        arr.push(Number(temp & _BigNumber.WORD_MASK));
        temp >>= _BigNumber.WORD_SIZE_BIGINT;
      }
      return arr.length > 0 ? arr : [0];
    }
    /**
     * Array of numbers, where each number represents a part of the value of the big number.
     *
     * @property words
     */
    get words() {
      const computed = this._computedWordsArray;
      if (this._nominalWordLength <= computed.length) {
        return computed;
      }
      const paddedWords = new Array(this._nominalWordLength).fill(0);
      for (let i = 0; i < computed.length; i++) {
        paddedWords[i] = computed[i];
      }
      return paddedWords;
    }
    /**
     * Sets the words array representing the value of the big number.
     */
    set words(newWords) {
      const oldSign = this._sign;
      let newMagnitude = 0n;
      const len = newWords.length > 0 ? newWords.length : 1;
      for (let i = len - 1; i >= 0; i--) {
        const wordVal = newWords[i] ?? 0;
        newMagnitude = newMagnitude << _BigNumber.WORD_SIZE_BIGINT | BigInt(wordVal & Number(_BigNumber.WORD_MASK));
      }
      this._magnitude = newMagnitude;
      this._sign = oldSign;
      this._nominalWordLength = len;
      this.normSign();
    }
    /**
     * Length of the words array.
     *
     * @property length
     */
    get length() {
      return Math.max(1, this._nominalWordLength);
    }
    /**
     * Checks whether a value is an instance of BigNumber. Regular JS numbers fail this check.
     *
     * @method isBN
     * @param num - The value to be checked.
     * @returns - Returns a boolean value determining whether or not the checked num parameter is a BigNumber.
     */
    static isBN(num) {
      if (num instanceof _BigNumber)
        return true;
      return num !== null && typeof num === "object" && num.constructor?.wordSize === _BigNumber.wordSize && Array.isArray(num.words);
    }
    /**
     * Returns the bigger value between two BigNumbers
     *
     * @method max
     * @param left - The first BigNumber to be compared.
     * @param right - The second BigNumber to be compared.
     * @returns - Returns the bigger BigNumber between left and right.
     */
    static max(left, right) {
      return left.cmp(right) > 0 ? left : right;
    }
    /**
     * Returns the smaller value between two BigNumbers
     *
     * @method min
     * @param left - The first BigNumber to be compared.
     * @param right - The second BigNumber to be compared.
     * @returns - Returns the smaller value between left and right.
     */
    static min(left, right) {
      return left.cmp(right) < 0 ? left : right;
    }
    _initFromString(number, effectiveBase, effectiveEndian) {
      if (effectiveBase === "hex")
        effectiveBase = 16;
      this.assert(typeof effectiveBase === "number" && effectiveBase === (effectiveBase | 0) && effectiveBase >= 2 && effectiveBase <= 36, "Base must be an integer between 2 and 36");
      const originalNumberStr = number.toString().replace(/\s+/g, "");
      let start = 0;
      let sign2 = 0;
      if (originalNumberStr.startsWith("-")) {
        start++;
        sign2 = 1;
      } else if (originalNumberStr.startsWith("+")) {
        start++;
      }
      const numStr = originalNumberStr.substring(start);
      if (numStr.length === 0) {
        this._initializeState(0n, sign2 === 1 && originalNumberStr.startsWith("-") ? 1 : 0);
        this.normSign();
        return;
      }
      if (effectiveBase === 16) {
        this._initFromHexString(numStr, sign2, effectiveEndian);
      } else {
        this._initFromNonHexString(numStr, effectiveBase, sign2, effectiveEndian);
      }
    }
    _initFromHexString(numStr, sign2, effectiveEndian) {
      if (effectiveEndian === "le") {
        const bytes2 = [];
        let hexStr = numStr;
        if (hexStr.length % 2 !== 0)
          hexStr = "0" + hexStr;
        for (let i = 0; i < hexStr.length; i += 2) {
          const byteHex = hexStr.substring(i, i + 2);
          const byteVal = Number.parseInt(byteHex, 16);
          if (Number.isNaN(byteVal))
            throw new Error("Invalid character in " + hexStr);
          bytes2.push(byteVal);
        }
        this.initArray(bytes2, "le");
        this._sign = sign2;
        this.normSign();
      } else {
        let tempMagnitude;
        try {
          tempMagnitude = BigInt("0x" + numStr);
        } catch (_bigIntParseError) {
          throw new Error("Invalid character in " + numStr);
        }
        this._initializeState(tempMagnitude, sign2);
        this.normSign();
      }
    }
    _initFromNonHexString(numStr, base, sign2, effectiveEndian) {
      try {
        this._parseBaseString(numStr, base);
        this._sign = sign2;
        this.normSign();
        if (effectiveEndian === "le") {
          const currentSign = this._sign;
          this.initArray(this.toArray("be"), "le");
          this._sign = currentSign;
          this.normSign();
        }
      } catch (err) {
        const error = err;
        if (error.message.includes("Invalid character in string") || error.message.includes("Invalid digit for base") || error.message.startsWith("Invalid character:")) {
          throw new Error("Invalid character");
        }
        throw error;
      }
    }
    _bigIntToStringInBase(num, base) {
      if (num === 0n)
        return "0";
      if (base < 2 || base > 36)
        throw new Error("Base must be between 2 and 36");
      const digits = "0123456789abcdefghijklmnopqrstuvwxyz";
      let result = "";
      let currentNum = num > 0n ? num : -num;
      const bigBase = BigInt(base);
      while (currentNum > 0n) {
        result = digits[Number(currentNum % bigBase)] + result;
        currentNum /= bigBase;
      }
      return result;
    }
    _parseBaseString(numberStr, base) {
      if (numberStr.length === 0) {
        this._magnitude = 0n;
        this._finishInitialization();
        return;
      }
      this._magnitude = 0n;
      const bigBase = BigInt(base);
      let groupSize = _BigNumber.groupSizes[base];
      let groupBaseBigInt = BigInt(_BigNumber.groupBases[base]);
      if (groupSize === 0 || groupBaseBigInt === 0n) {
        groupSize = Math.floor(Math.log(67108863) / Math.log(base));
        if (groupSize === 0)
          groupSize = 1;
        groupBaseBigInt = bigBase ** BigInt(groupSize);
      }
      let currentPos = 0;
      const totalLen = numberStr.length;
      let firstChunkLen = totalLen % groupSize;
      if (firstChunkLen === 0 && totalLen > 0)
        firstChunkLen = groupSize;
      if (firstChunkLen > 0) {
        const chunkStr = numberStr.substring(currentPos, currentPos + firstChunkLen);
        this._magnitude = BigInt(this._parseBaseWord(chunkStr, base));
        currentPos += firstChunkLen;
      }
      while (currentPos < totalLen) {
        const chunkStr = numberStr.substring(currentPos, currentPos + groupSize);
        const wordVal = BigInt(this._parseBaseWord(chunkStr, base));
        this._magnitude = this._magnitude * groupBaseBigInt + wordVal;
        currentPos += groupSize;
      }
      this._finishInitialization();
    }
    _parseBaseWord(str, base) {
      let r2 = 0;
      for (let i = 0; i < str.length; i++) {
        const charCode = str.codePointAt(i);
        let digitVal;
        if (charCode >= 48 && charCode <= 57)
          digitVal = charCode - 48;
        else if (charCode >= 65 && charCode <= 90)
          digitVal = charCode - 65 + 10;
        else if (charCode >= 97 && charCode <= 122)
          digitVal = charCode - 97 + 10;
        else
          throw new Error("Invalid character: " + str[i]);
        if (digitVal >= base)
          throw new Error("Invalid character");
        r2 = r2 * base + digitVal;
      }
      return r2;
    }
    _initializeState(magnitude, sign2) {
      this._magnitude = magnitude;
      this._sign = magnitude === 0n ? 0 : sign2;
      this._finishInitialization();
    }
    _finishInitialization() {
      if (this._magnitude === 0n) {
        this._nominalWordLength = 1;
        this._sign = 0;
      } else {
        const bitLen = this._magnitude.toString(2).length;
        this._nominalWordLength = Math.max(1, Math.ceil(bitLen / _BigNumber.wordSize));
      }
    }
    assert(val2, msg = "Assertion failed") {
      if (!val2)
        throw new Error(msg);
    }
    initNumber(number, endian = "be") {
      this.assert(BigInt(Math.abs(number)) <= _BigNumber.MAX_NUMBER_CONSTRUCTOR_MAG_BIGINT, "The number is larger than 2 ^ 53 (unsafe)");
      this.assert(number % 1 === 0, "Number must be an integer for BigNumber conversion");
      this._initializeState(BigInt(Math.abs(number)), number < 0 ? 1 : 0);
      if (endian === "le") {
        const currentSign = this._sign;
        const beBytes = this.toArray("be");
        this.initArray(beBytes, "le");
        this._sign = currentSign;
        this.normSign();
      }
      return this;
    }
    initArray(bytes2, endian) {
      if (bytes2.length === 0) {
        this._initializeState(0n, 0);
        return this;
      }
      let magnitude = 0n;
      if (endian === "be") {
        for (const byte of bytes2)
          magnitude = magnitude << 8n | BigInt(byte & 255);
      } else {
        for (let i = bytes2.length - 1; i >= 0; i--)
          magnitude = magnitude << 8n | BigInt(bytes2[i] & 255);
      }
      this._initializeState(magnitude, 0);
      return this;
    }
    copy(dest) {
      dest._magnitude = this._magnitude;
      dest._sign = this._sign;
      dest._nominalWordLength = this._nominalWordLength;
      dest.red = this.red;
    }
    static move(dest, src) {
      dest._magnitude = src._magnitude;
      dest._sign = src._sign;
      dest._nominalWordLength = src._nominalWordLength;
      dest.red = src.red;
    }
    clone() {
      const r2 = new _BigNumber(0n);
      this.copy(r2);
      return r2;
    }
    expand(size) {
      this.assert(size >= 0, "Expand size must be non-negative");
      this._nominalWordLength = Math.max(this._nominalWordLength, size, 1);
      return this;
    }
    strip() {
      this._finishInitialization();
      return this.normSign();
    }
    normSign() {
      if (this._magnitude === 0n) {
        this._sign = 0;
      }
      return this;
    }
    inspect() {
      return (this.red === null ? "<BN: " : "<BN-R: ") + this.toString(16) + ">";
    }
    _getMinimalHex() {
      if (this._magnitude === 0n)
        return "0";
      return this._magnitude.toString(16);
    }
    /**
     * Converts the BigNumber instance to a string representation.
     *
     * @method toString
     * @param base - The base for representing number. Default is 10. Other accepted values are 16 and 'hex'.
     * @param padding - Represents the minimum number of digits to represent the BigNumber as a string. Default is 1.
     * @returns The string representation of the BigNumber instance
     */
    toString(base = 10, padding = 1) {
      if (base === 16 || base === "hex") {
        let hexStr = this._getMinimalHex();
        if (padding > 1) {
          if (hexStr !== "0" && hexStr.length % 2 !== 0) {
            hexStr = "0" + hexStr;
          }
          while (hexStr.length % padding !== 0) {
            hexStr = "0" + hexStr;
          }
        }
        return (this.isNeg() ? "-" : "") + hexStr;
      }
      if (typeof base !== "number" || base < 2 || base > 36 || base % 1 !== 0)
        throw new Error("Base should be an integer between 2 and 36");
      return this.toBaseString(base, padding);
    }
    toBaseString(base, padding) {
      if (this._magnitude === 0n) {
        let out2 = "0";
        if (padding > 1) {
          while (out2.length < padding)
            out2 = "0" + out2;
        }
        return out2;
      }
      let groupSize = _BigNumber.groupSizes[base];
      let groupBaseBigInt = BigInt(_BigNumber.groupBases[base]);
      if (groupSize === 0 || groupBaseBigInt === 0n) {
        groupSize = Math.floor(Math.log(Number.MAX_SAFE_INTEGER) / Math.log(base));
        if (groupSize === 0)
          groupSize = 1;
        groupBaseBigInt = BigInt(base) ** BigInt(groupSize);
      }
      let out = "";
      let tempMag = this._magnitude;
      while (tempMag > 0n) {
        const remainder = tempMag % groupBaseBigInt;
        tempMag /= groupBaseBigInt;
        const chunkStr = this._bigIntToStringInBase(remainder, base);
        out = (tempMag > 0n ? this._zeroPaddedChunk(chunkStr, groupSize) : chunkStr) + out;
      }
      if (padding > 0) {
        while (out.length < padding)
          out = "0" + out;
      }
      return (this._sign === 1 ? "-" : "") + out;
    }
    /** Returns a chunk string zero-padded to groupSize (used by toBaseString for interior chunks). */
    _zeroPaddedChunk(chunkStr, groupSize) {
      const zerosToPrepend = groupSize - chunkStr.length;
      if (zerosToPrepend <= 0)
        return chunkStr;
      if (zerosToPrepend < _BigNumber.zeros.length)
        return _BigNumber.zeros[zerosToPrepend] + chunkStr;
      return "0".repeat(zerosToPrepend) + chunkStr;
    }
    /**
     * Converts the BigNumber instance to a JavaScript number.
     * Please note that JavaScript numbers are only precise up to 53 bits.
     *
     * @method toNumber
     * @throws If the BigNumber instance cannot be safely stored in a JavaScript number
     * @returns The JavaScript number representation of the BigNumber instance.
     */
    toNumber() {
      const val2 = this._getSignedValue();
      if (val2 > _BigNumber.MAX_SAFE_INTEGER_BIGINT || val2 < _BigNumber.MIN_SAFE_INTEGER_BIGINT)
        throw new Error("Number can only safely store up to 53 bits");
      return Number(val2);
    }
    /**
     * Returns the signed BigInt representation of this BigNumber without any safety checks.
     *
     * @method toBigInt
     * @returns bigint value for this BigNumber.
     */
    toBigInt() {
      return this._getSignedValue();
    }
    /**
     * Converts the BigNumber instance to a JSON-formatted string.
     *
     * @method toJSON
     * @returns The JSON string representation of the BigNumber instance.
     */
    toJSON() {
      const hex = this._getMinimalHex();
      return (this.isNeg() ? "-" : "") + hex;
    }
    toArrayLikeGeneric(res, isLE) {
      let tempMag = this._magnitude;
      let position = isLE ? 0 : res.length - 1;
      const increment = isLE ? 1 : -1;
      for (let k = 0; k < res.length; ++k) {
        if (tempMag === 0n && position >= 0 && position < res.length) {
          res[position] = 0;
        } else if (position >= 0 && position < res.length) {
          res[position] = Number(tempMag & 0xffn);
        } else {
          break;
        }
        tempMag >>= 8n;
        position += increment;
      }
    }
    /**
     * Converts the BigNumber instance to an array of bytes.
     *
     * @method toArray
     * @param endian - Endianness of the output array, defaults to 'be'.
     * @param length - Optional length of the output array.
     * @returns Array of bytes representing the BigNumber.
     */
    toArray(endian = "be", length) {
      this.strip();
      const actualByteLength = this.byteLength();
      const reqLength = length ?? Math.max(1, actualByteLength);
      this.assert(actualByteLength <= reqLength, "byte array longer than desired length");
      this.assert(reqLength > 0, "Requested array length <= 0");
      const res = new Array(reqLength).fill(0);
      if (this._magnitude === 0n && reqLength > 0)
        return res;
      if (this._magnitude === 0n && reqLength === 0)
        return [];
      this.toArrayLikeGeneric(res, endian === "le");
      return res;
    }
    /**
     * Calculates the number of bits required to represent the BigNumber.
     *
     * @method bitLength
     * @returns The bit length of the BigNumber.
     */
    bitLength() {
      if (this._magnitude === 0n) {
        return 0;
      }
      return this._magnitude.toString(2).length;
    }
    /**
     * Converts a BigNumber to an array of bits.
     *
     * @method toBitArray
     * @param num - The BigNumber to convert.
     * @returns An array of bits.
     */
    static toBitArray(num) {
      const len = num.bitLength();
      if (len === 0)
        return [];
      const w = new Array(len);
      const mag = num._magnitude;
      for (let bit = 0; bit < len; bit++) {
        w[bit] = (mag >> BigInt(bit) & 1n) === 0n ? 0 : 1;
      }
      return w;
    }
    /**
     * Instance version of {@link toBitArray}.
     */
    toBitArray() {
      return _BigNumber.toBitArray(this);
    }
    /**
     * Returns the number of trailing zero bits in the big number.
     *
     * @method zeroBits
     * @returns Returns the number of trailing zero bits
     * in the binary representation of the big number.
     *
     * @example
     * const bn = new BigNumber('8'); // binary: 1000
     * const zeroBits = bn.zeroBits(); // 3
     */
    zeroBits() {
      if (this._magnitude === 0n)
        return 0;
      let c = 0;
      let t = this._magnitude;
      while ((t & 1n) === 0n && t !== 0n) {
        c++;
        t >>= 1n;
      }
      return c;
    }
    /**
     * Calculates the number of bytes required to represent the BigNumber.
     *
     * @method byteLength
     * @returns The byte length of the BigNumber.
     */
    byteLength() {
      if (this._magnitude === 0n) {
        return 0;
      }
      return Math.ceil(this.bitLength() / 8);
    }
    _getSignedValue() {
      return this._sign === 1 ? -this._magnitude : this._magnitude;
    }
    _setValueFromSigned(sVal) {
      if (sVal < 0n) {
        this._magnitude = -sVal;
        this._sign = 1;
      } else {
        this._magnitude = sVal;
        this._sign = 0;
      }
      this._finishInitialization();
      this.normSign();
    }
    toTwos(width) {
      this.assert(width >= 0);
      const Bw = BigInt(width);
      let v = this._getSignedValue();
      if (this._sign === 1 && this._magnitude !== 0n)
        v = (1n << Bw) + v;
      const m = (1n << Bw) - 1n;
      v &= m;
      const r2 = new _BigNumber(0n);
      r2._initializeState(v, 0);
      return r2;
    }
    fromTwos(width) {
      this.assert(width >= 0);
      const Bw = BigInt(width);
      const m = this._magnitude;
      if (width > 0 && (m >> Bw - 1n & 1n) !== 0n && this._sign === 0) {
        const sVal = m - (1n << Bw);
        const r2 = new _BigNumber(0n);
        r2._setValueFromSigned(sVal);
        return r2;
      }
      return this.clone();
    }
    isNeg() {
      return this._sign === 1 && this._magnitude !== 0n;
    }
    neg() {
      return this.clone().ineg();
    }
    ineg() {
      if (this._magnitude !== 0n) {
        this._sign = this._sign === 1 ? 0 : 1;
      }
      return this;
    }
    _iuop(num, op3, isXor = false) {
      const newMag = op3(this._magnitude, num._magnitude);
      let targetNominalLength = this._nominalWordLength;
      if (isXor)
        targetNominalLength = Math.max(this.length, num.length);
      this._magnitude = newMag;
      this._finishInitialization();
      if (isXor)
        this._nominalWordLength = Math.max(this._nominalWordLength, targetNominalLength);
      return this.strip();
    }
    iuor(num) {
      return this._iuop(num, (a, b) => a | b);
    }
    iuand(num) {
      return this._iuop(num, (a, b) => a & b);
    }
    iuxor(num) {
      return this._iuop(num, (a, b) => a ^ b, true);
    }
    _iop(num, op3, isXor = false) {
      this.assert(this._sign === 0 && num._sign === 0);
      return this._iuop(num, op3, isXor);
    }
    ior(num) {
      return this._iop(num, (a, b) => a | b);
    }
    iand(num) {
      return this._iop(num, (a, b) => a & b);
    }
    ixor(num) {
      return this._iop(num, (a, b) => a ^ b, true);
    }
    _uop_new(num, opName) {
      if (this.length >= num.length) {
        return this.clone()[opName](num);
      }
      return num.clone()[opName](this);
    }
    or(num) {
      this.assert(this._sign === 0 && num._sign === 0);
      return this._uop_new(num, "iuor");
    }
    uor(num) {
      return this._uop_new(num, "iuor");
    }
    and(num) {
      this.assert(this._sign === 0 && num._sign === 0);
      return this._uop_new(num, "iuand");
    }
    uand(num) {
      return this._uop_new(num, "iuand");
    }
    xor(num) {
      this.assert(this._sign === 0 && num._sign === 0);
      return this._uop_new(num, "iuxor");
    }
    uxor(num) {
      return this._uop_new(num, "iuxor");
    }
    inotn(width) {
      this.assert(typeof width === "number" && width >= 0);
      const Bw = BigInt(width);
      const m = (1n << Bw) - 1n;
      this._magnitude = ~this._magnitude & m;
      const wfw = width === 0 ? 1 : Math.ceil(width / _BigNumber.wordSize);
      this._nominalWordLength = Math.max(1, wfw);
      this.strip();
      this._nominalWordLength = Math.max(this._nominalWordLength, Math.max(1, wfw));
      return this;
    }
    notn(width) {
      return this.clone().inotn(width);
    }
    setn(bit, val2) {
      this.assert(typeof bit === "number" && bit >= 0);
      const Bb = BigInt(bit);
      if (val2 === 1 || val2 === true)
        this._magnitude |= 1n << Bb;
      else
        this._magnitude &= ~(1n << Bb);
      const wnb = Math.floor(bit / _BigNumber.wordSize) + 1;
      this._nominalWordLength = Math.max(this._nominalWordLength, wnb);
      this._finishInitialization();
      return this.strip();
    }
    iadd(num) {
      this._setValueFromSigned(this._getSignedValue() + num._getSignedValue());
      return this;
    }
    add(num) {
      const r2 = new _BigNumber(0n);
      r2._setValueFromSigned(this._getSignedValue() + num._getSignedValue());
      return r2;
    }
    isub(num) {
      this._setValueFromSigned(this._getSignedValue() - num._getSignedValue());
      return this;
    }
    sub(num) {
      const r2 = new _BigNumber(0n);
      r2._setValueFromSigned(this._getSignedValue() - num._getSignedValue());
      return r2;
    }
    mul(num) {
      const r2 = new _BigNumber(0n);
      r2._magnitude = this._magnitude * num._magnitude;
      r2._sign = r2._magnitude === 0n ? 0 : this._sign ^ num._sign;
      r2._nominalWordLength = this.length + num.length;
      r2.red = null;
      return r2.normSign();
    }
    imul(num) {
      this._magnitude *= num._magnitude;
      this._sign = this._magnitude === 0n ? 0 : this._sign ^ num._sign;
      this._nominalWordLength = this.length + num.length;
      this.red = null;
      return this.normSign();
    }
    imuln(num) {
      this.assert(typeof num === "number", "Assertion failed");
      this.assert(Math.abs(num) <= _BigNumber.MAX_IMULN_ARG, "Assertion failed");
      this._setValueFromSigned(this._getSignedValue() * BigInt(num));
      return this;
    }
    muln(num) {
      return this.clone().imuln(num);
    }
    sqr() {
      const r2 = new _BigNumber(0n);
      r2._magnitude = this._magnitude * this._magnitude;
      r2._sign = 0;
      r2._nominalWordLength = this.length * 2;
      r2.red = null;
      return r2;
    }
    isqr() {
      this._magnitude *= this._magnitude;
      this._sign = 0;
      this._nominalWordLength = this.length * 2;
      this.red = null;
      return this;
    }
    pow(num) {
      this.assert(num._sign === 0, "Exponent for pow must be non-negative");
      if (num.isZero())
        return new _BigNumber(1n);
      const res = new _BigNumber(1n);
      const currentBase = this.clone();
      const exp = num.clone();
      const baseIsNegative = currentBase.isNeg();
      const expIsOdd = exp.isOdd();
      if (baseIsNegative)
        currentBase.ineg();
      while (!exp.isZero()) {
        if (exp.isOdd()) {
          res.imul(currentBase);
        }
        currentBase.isqr();
        exp.iushrn(1);
      }
      if (baseIsNegative && expIsOdd) {
        res.ineg();
      }
      return res;
    }
    static normalizeNonNegativeBigInt(value, label) {
      if (typeof value === "number") {
        if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0)
          throw new Error(`${label} must be a non-negative integer`);
        return BigInt(value);
      }
      if (value < 0n)
        throw new Error(`${label} must be a non-negative integer`);
      return value;
    }
    iushln(bits) {
      const normalizedBits = _BigNumber.normalizeNonNegativeBigInt(bits, "Shift bits");
      if (normalizedBits === 0n)
        return this;
      this._magnitude <<= normalizedBits;
      this._finishInitialization();
      return this.strip();
    }
    ishln(bits) {
      this.assert(this._sign === 0, "ishln requires positive number");
      return this.iushln(bits);
    }
    iushrn(bits, hint, extended) {
      const normalizedBits = _BigNumber.normalizeNonNegativeBigInt(bits, "Shift bits");
      if (normalizedBits === 0n) {
        if (extended != null)
          extended._initializeState(0n, 0);
        return this;
      }
      if (extended != null) {
        const m = (1n << normalizedBits) - 1n;
        const sOut = this._magnitude & m;
        extended._initializeState(sOut, 0);
      }
      this._magnitude >>= normalizedBits;
      this._finishInitialization();
      return this.strip();
    }
    ishrn(bits, hint, extended) {
      this.assert(this._sign === 0, "ishrn requires positive number");
      return this.iushrn(bits, hint, extended);
    }
    shln(bits) {
      return this.clone().ishln(bits);
    }
    ushln(bits) {
      return this.clone().iushln(bits);
    }
    shrn(bits) {
      return this.clone().ishrn(bits);
    }
    ushrn(bits) {
      return this.clone().iushrn(bits);
    }
    testn(bit) {
      this.assert(typeof bit === "number" && bit >= 0);
      return (this._magnitude >> BigInt(bit) & 1n) !== 0n;
    }
    imaskn(bits) {
      this.assert(typeof bits === "number" && bits >= 0);
      this.assert(this._sign === 0, "imaskn works only with positive numbers");
      const Bb = BigInt(bits);
      const m = Bb === 0n ? 0n : (1n << Bb) - 1n;
      this._magnitude &= m;
      const wfm = bits === 0 ? 1 : Math.max(1, Math.ceil(bits / _BigNumber.wordSize));
      this._nominalWordLength = wfm;
      this._finishInitialization();
      this._nominalWordLength = Math.max(this._nominalWordLength, wfm);
      return this.strip();
    }
    maskn(bits) {
      return this.clone().imaskn(bits);
    }
    iaddn(num) {
      this.assert(typeof num === "number");
      this.assert(Math.abs(num) <= _BigNumber.MAX_IMULN_ARG, "num is too large");
      this._setValueFromSigned(this._getSignedValue() + BigInt(num));
      return this;
    }
    _iaddn(num) {
      return this.iaddn(num);
    }
    isubn(num) {
      this.assert(typeof num === "number");
      this.assert(Math.abs(num) <= _BigNumber.MAX_IMULN_ARG, "Assertion failed");
      this._setValueFromSigned(this._getSignedValue() - BigInt(num));
      return this;
    }
    addn(num) {
      return this.clone().iaddn(num);
    }
    subn(num) {
      return this.clone().isubn(num);
    }
    iabs() {
      this._sign = 0;
      return this;
    }
    abs() {
      return this.clone().iabs();
    }
    divmod(num, mode, positive) {
      this.assert(!num.isZero(), "Division by zero");
      if (this.isZero()) {
        const z = new _BigNumber(0n);
        return { div: mode === "mod" ? null : z, mod: mode === "div" ? null : z };
      }
      const tV = this._getSignedValue();
      const nV = num._getSignedValue();
      const dV = mode !== "mod" ? tV / nV : null;
      const mV = this._computeMod(tV, nV, mode, positive);
      return { div: this._bigNumberFromSigned(dV), mod: this._bigNumberFromSigned(mV) };
    }
    _computeMod(tV, nV, mode, positive) {
      if (mode === "div")
        return null;
      let mV = tV % nV;
      if (positive === true && mV < 0n)
        mV += nV < 0n ? -nV : nV;
      return mV;
    }
    _bigNumberFromSigned(v) {
      if (v === null)
        return null;
      const r2 = new _BigNumber(0n);
      r2._setValueFromSigned(v);
      return r2;
    }
    div(num) {
      return this.divmod(num, "div", false).div;
    }
    mod(num) {
      return this.divmod(num, "mod", false).mod;
    }
    umod(num) {
      return this.divmod(num, "mod", true).mod;
    }
    divRound(num) {
      this.assert(!num.isZero());
      const tV = this._getSignedValue();
      const nV = num._getSignedValue();
      let d = tV / nV;
      const m = tV % nV;
      if (m === 0n) {
        const r3 = new _BigNumber(0n);
        r3._setValueFromSigned(d);
        return r3;
      }
      const absM = m < 0n ? -m : m;
      const absNV = nV < 0n ? -nV : nV;
      if (absM * 2n >= absNV) {
        if (tV > 0n && nV > 0n || tV < 0n && nV < 0n) {
          d += 1n;
        } else {
          d -= 1n;
        }
      }
      const r2 = new _BigNumber(0n);
      r2._setValueFromSigned(d);
      return r2;
    }
    modrn(numArg) {
      this.assert(numArg !== 0, "Division by zero in modrn");
      const absDivisor = BigInt(Math.abs(numArg));
      if (absDivisor === 0n)
        throw new Error("Division by zero in modrn");
      const remainderMag = this._magnitude % absDivisor;
      return numArg < 0 ? Number(-remainderMag) : Number(remainderMag);
    }
    idivn(num) {
      this.assert(num !== 0);
      this.assert(Math.abs(num) <= _BigNumber.MAX_IMULN_ARG, "num is too large");
      this._setValueFromSigned(this._getSignedValue() / BigInt(num));
      return this;
    }
    divn(num) {
      return this.clone().idivn(num);
    }
    egcd(p) {
      this.assert(p._sign === 0, "p must not be negative");
      this.assert(!p.isZero(), "p must not be zero");
      let uV = this._getSignedValue();
      let vV = p._magnitude;
      let a = 1n;
      let pa = 0n;
      let b = 0n;
      let pb = 1n;
      while (vV !== 0n) {
        const q = uV / vV;
        let t = vV;
        vV = uV % vV;
        uV = t;
        t = pa;
        pa = a - q * pa;
        a = t;
        t = pb;
        pb = b - q * pb;
        b = t;
      }
      const ra = new _BigNumber(0n);
      ra._setValueFromSigned(a);
      const rb = new _BigNumber(0n);
      rb._setValueFromSigned(b);
      const rg = new _BigNumber(0n);
      rg._initializeState(uV < 0n ? -uV : uV, 0);
      return { a: ra, b: rb, gcd: rg };
    }
    gcd(num) {
      let u = this._magnitude;
      let v = num._magnitude;
      if (u === 0n) {
        const r2 = new _BigNumber(0n);
        r2._setValueFromSigned(v);
        return r2.iabs();
      }
      if (v === 0n) {
        const r2 = new _BigNumber(0n);
        r2._setValueFromSigned(u);
        return r2.iabs();
      }
      while (v !== 0n) {
        const t = u % v;
        u = v;
        v = t;
      }
      const res = new _BigNumber(0n);
      res._initializeState(u, 0);
      return res;
    }
    invm(num) {
      this.assert(!num.isZero() && num._sign === 0, "Modulus for invm must be positive and non-zero");
      const eg = this.egcd(num);
      if (!eg.gcd.eqn(1)) {
        throw new Error("Inverse does not exist (numbers are not coprime).");
      }
      return eg.a.umod(num);
    }
    isEven() {
      return this._magnitude % 2n === 0n;
    }
    isOdd() {
      return this._magnitude % 2n === 1n;
    }
    andln(num) {
      this.assert(num >= 0);
      return Number(this._magnitude & BigInt(num));
    }
    bincn(bit) {
      this.assert(typeof bit === "number" && bit >= 0);
      const BVal = 1n << BigInt(bit);
      this._setValueFromSigned(this._getSignedValue() + BVal);
      return this;
    }
    isZero() {
      return this._magnitude === 0n;
    }
    cmpn(num) {
      this.assert(Math.abs(num) <= _BigNumber.MAX_IMULN_ARG, "Number is too big");
      const tV = this._getSignedValue();
      const nV = BigInt(num);
      if (tV < nV) {
        return -1;
      }
      if (tV > nV) {
        return 1;
      }
      return 0;
    }
    cmp(num) {
      const tV = this._getSignedValue();
      const nV = num._getSignedValue();
      if (tV < nV) {
        return -1;
      }
      if (tV > nV) {
        return 1;
      }
      return 0;
    }
    ucmp(num) {
      if (this._magnitude < num._magnitude) {
        return -1;
      }
      if (this._magnitude > num._magnitude) {
        return 1;
      }
      return 0;
    }
    gtn(num) {
      return this.cmpn(num) === 1;
    }
    gt(num) {
      return this.cmp(num) === 1;
    }
    gten(num) {
      return this.cmpn(num) >= 0;
    }
    gte(num) {
      return this.cmp(num) >= 0;
    }
    ltn(num) {
      return this.cmpn(num) === -1;
    }
    lt(num) {
      return this.cmp(num) === -1;
    }
    lten(num) {
      return this.cmpn(num) <= 0;
    }
    lte(num) {
      return this.cmp(num) <= 0;
    }
    eqn(num) {
      return this.cmpn(num) === 0;
    }
    eq(num) {
      return this.cmp(num) === 0;
    }
    toRed(ctx) {
      this.assert(this.red == null, "Already a number in reduction context");
      this.assert(this._sign === 0, "toRed works only with positives");
      return ctx.convertTo(this).forceRed(ctx);
    }
    fromRed() {
      this.assert(this.red, "fromRed works only with numbers in reduction context");
      return this.red.convertFrom(this);
    }
    forceRed(ctx) {
      this.red = ctx;
      return this;
    }
    redAdd(num) {
      this.assert(this.red, "redAdd works only with red numbers");
      return this.red.add(this, num);
    }
    redIAdd(num) {
      this.assert(this.red, "redIAdd works only with red numbers");
      return this.red.iadd(this, num);
    }
    redSub(num) {
      this.assert(this.red, "redSub works only with red numbers");
      return this.red.sub(this, num);
    }
    redISub(num) {
      this.assert(this.red, "redISub works only with red numbers");
      return this.red.isub(this, num);
    }
    redShl(num) {
      this.assert(this.red, "redShl works only with red numbers");
      return this.red.shl(this, num);
    }
    redMul(num) {
      this.assert(this.red, "redMul works only with red numbers");
      this.red.verify2(this, num);
      return this.red.mul(this, num);
    }
    redIMul(num) {
      this.assert(this.red, "redIMul works only with red numbers");
      this.red.verify2(this, num);
      return this.red.imul(this, num);
    }
    redSqr() {
      this.assert(this.red, "redSqr works only with red numbers");
      this.red.verify1(this);
      return this.red.sqr(this);
    }
    redISqr() {
      this.assert(this.red, "redISqr works only with red numbers");
      this.red.verify1(this);
      return this.red.isqr(this);
    }
    redSqrt() {
      this.assert(this.red, "redSqrt works only with red numbers");
      this.red.verify1(this);
      return this.red.sqrt(this);
    }
    redInvm() {
      this.assert(this.red, "redInvm works only with red numbers");
      this.red.verify1(this);
      return this.red.invm(this);
    }
    redNeg() {
      this.assert(this.red, "redNeg works only with red numbers");
      this.red.verify1(this);
      return this.red.neg(this);
    }
    redPow(num) {
      this.assert(this.red != null && num.red == null, "redPow(normalNum)");
      this.red.verify1(this);
      return this.red.pow(this, num);
    }
    /**
     * Creates a BigNumber from a hexadecimal string.
     *
     * @static
     * @method fromHex
     * @param hex - The hexadecimal string to create a BigNumber from.
     * @param endian - Optional endianness for parsing the hex string.
     * @returns Returns a BigNumber created from the hexadecimal input string.
     *
     * @example
     * const exampleHex = 'a1b2c3';
     * const bigNumber = BigNumber.fromHex(exampleHex);
     */
    static fromHex(hex, endian) {
      let eE = "be";
      if (endian === "little" || endian === "le")
        eE = "le";
      return new _BigNumber(hex, 16, eE);
    }
    /**
     * Converts this BigNumber to a hexadecimal string.
     *
     * @method toHex
     * @param length - The minimum length of the hex string
     * @returns Returns a string representing the hexadecimal value of this BigNumber.
     *
     * @example
     * const bigNumber = new BigNumber(255)
     * const hex = bigNumber.toHex()
     */
    toHex(byteLength = 0) {
      if (this.isZero() && byteLength === 0)
        return "";
      let hexStr = this._getMinimalHex();
      if (hexStr !== "0" && hexStr.length % 2 !== 0) {
        hexStr = "0" + hexStr;
      }
      const minChars = byteLength * 2;
      while (hexStr.length < minChars) {
        hexStr = "0" + hexStr;
      }
      return (this.isNeg() ? "-" : "") + hexStr;
    }
    /**
     * Creates a BigNumber from a JSON-serialized string.
     *
     * @static
     * @method fromJSON
     * @param str - The JSON-serialized string to create a BigNumber from.
     * @returns Returns a BigNumber created from the JSON input string.
     */
    static fromJSON(str) {
      return new _BigNumber(str, 16);
    }
    /**
     * Creates a BigNumber from a number.
     *
     * @static
     * @method fromNumber
     * @param n - The number to create a BigNumber from.
     * @returns Returns a BigNumber equivalent to the input number.
     */
    static fromNumber(n) {
      return new _BigNumber(n);
    }
    /**
     * Creates a BigNumber from a string, considering an optional base.
     *
     * @static
     * @method fromString
     * @param str - The string to create a BigNumber from.
     * @param base - The base used for conversion. If not provided, base 10 is assumed.
     * @returns Returns a BigNumber equivalent to the string after conversion from the specified base.
     */
    static fromString(str, base) {
      return new _BigNumber(str, base);
    }
    /**
     * Creates a BigNumber from a signed magnitude number.
     *
     * @static
     * @method fromSm
     * @param bytes - The signed magnitude number to convert to a BigNumber.
     * @param endian - Defines endianess. If not provided, big endian is assumed.
     * @returns Returns a BigNumber equivalent to the signed magnitude number interpreted with specified endianess.
     */
    static fromSm(bytes2, endian = "big") {
      if (bytes2.length === 0)
        return new _BigNumber(0n);
      const beBytes = bytes2.slice();
      if (endian === "little") {
        beBytes.reverse();
      }
      let sign2 = 0;
      if (beBytes.length > 0 && (beBytes[0] & 128) !== 0) {
        sign2 = 1;
        beBytes[0] &= 127;
      }
      let hexStr;
      if (CAN_USE_BUFFER) {
        hexStr = BufferCtor.from(beBytes).toString("hex");
      } else {
        hexStr = "";
        for (const byte of beBytes) {
          hexStr += byte < 16 ? "0" + byte.toString(16) : byte.toString(16);
        }
      }
      const magnitude = hexStr.length === 0 ? 0n : BigInt("0x" + hexStr);
      const r2 = new _BigNumber(0n);
      r2._initializeState(magnitude, sign2);
      return r2;
    }
    /**
     * Converts this BigNumber to a signed magnitude number.
     *
     * @method toSm
     * @param endian - Defines endianess. If not provided, big endian is assumed.
     * @returns Returns an array equivalent to this BigNumber interpreted as a signed magnitude with specified endianess.
     */
    toSm(endian = "big") {
      if (this._magnitude === 0n) {
        return this._sign === 1 ? [128] : [];
      }
      let hex = this._getMinimalHex();
      if (hex.length % 2 !== 0)
        hex = "0" + hex;
      const byteLen = hex.length / 2;
      const bytes2 = new Array(byteLen);
      for (let i = 0, j = 0; i < hex.length; i += 2) {
        const high = HEX_CHAR_TO_VALUE[hex.codePointAt(i)];
        const low = HEX_CHAR_TO_VALUE[hex.codePointAt(i + 1)];
        bytes2[j++] = (high & 15) << 4 | low & 15;
      }
      let result;
      if (this._sign === 1) {
        if ((bytes2[0] & 128) === 0) {
          result = bytes2.slice();
          result[0] |= 128;
        } else {
          result = [128, ...bytes2];
        }
      } else if ((bytes2[0] & 128) === 0) {
        result = bytes2.slice();
      } else {
        result = [0, ...bytes2];
      }
      return endian === "little" ? result.reverse() : result;
    }
    /**
     * Creates a BigNumber from a number representing the "bits" value in a block header.
     *
     * @static
     * @method fromBits
     * @param bits - The number representing the bits value in a block header.
     * @param strict - If true, an error is thrown if the number has negative bit set.
     * @returns Returns a BigNumber equivalent to the "bits" value in a block header.
     * @throws Will throw an error if `strict` is `true` and the number has negative bit set.
     */
    static fromBits(bits, strict = false) {
      const nSize = bits >>> 24;
      const nWordCompact = bits & 8388607;
      const isNegativeFromBit = (bits & 8388608) !== 0;
      if (strict && isNegativeFromBit) {
        throw new Error("negative bit set");
      }
      if (nSize === 0 && nWordCompact === 0) {
        if (isNegativeFromBit && strict)
          throw new Error("negative bit set for zero value");
        return new _BigNumber(0n);
      }
      const bn = new _BigNumber(nWordCompact);
      if (nSize <= 3) {
        bn.iushrn((3 - nSize) * 8);
      } else {
        bn.iushln((nSize - 3) * 8);
      }
      if (isNegativeFromBit) {
        bn.ineg();
      }
      return bn;
    }
    /**
     * Converts this BigNumber to a number representing the "bits" value in a block header.
     *
     * @method toBits
     * @returns Returns a number equivalent to the "bits" value in a block header.
     */
    toBits() {
      this.strip();
      if (this.isZero() && !this.isNeg())
        return 0;
      const isActualNegative = this.isNeg();
      const bnAbs = this.abs();
      let mB = bnAbs.toArray("be");
      let firstNonZeroIdx = 0;
      while (firstNonZeroIdx < mB.length - 1 && mB[firstNonZeroIdx] === 0) {
        firstNonZeroIdx++;
      }
      mB = mB.slice(firstNonZeroIdx);
      let nSize = mB.length;
      if (nSize === 0 && !bnAbs.isZero()) {
        mB = [0];
        nSize = 1;
      }
      if (bnAbs.isZero()) {
        nSize = 0;
        mB = [];
      }
      let nWordNum;
      if (nSize === 0) {
        nWordNum = 0;
      } else if (nSize <= 3) {
        nWordNum = 0;
        for (let i = 0; i < nSize; i++) {
          nWordNum = nWordNum << 8 | mB[i];
        }
      } else {
        nWordNum = mB[0] << 16 | mB[1] << 8 | mB[2];
      }
      if ((nWordNum & 8388608) !== 0 && nSize <= 255) {
        nWordNum >>>= 8;
        nSize++;
      }
      let b = nSize << 24 | nWordNum;
      if (isActualNegative)
        b |= 8388608;
      return b >>> 0;
    }
    /**
     * Creates a BigNumber from the format used in Bitcoin scripts.
     *
     * @static
     * @method fromScriptNum
     * @param num - The number in the format used in Bitcoin scripts.
     * @param requireMinimal - If true, non-minimally encoded values will throw an error.
     * @param maxNumSize - The maximum allowed size for the number.
     * @returns Returns a BigNumber equivalent to the number used in a Bitcoin script.
     */
    static fromScriptNum(num, requireMinimal = false, maxNumSize) {
      if (maxNumSize !== void 0 && num.length > maxNumSize)
        throw new Error("script number overflow");
      if (num.length === 0)
        return new _BigNumber(0n);
      if (requireMinimal) {
        if ((num.at(-1) & 127) === 0) {
          if (num.length <= 1 || (num.at(-2) & 128) === 0) {
            throw new Error("non-minimally encoded script number");
          }
        }
      }
      return _BigNumber.fromSm(num, "little");
    }
    /**
     * Converts this BigNumber to a number in the format used in Bitcoin scripts.
     *
     * @method toScriptNum
     * @returns Returns the equivalent to this BigNumber as a Bitcoin script number.
     */
    toScriptNum() {
      return this.toSm("little");
    }
    /**
     * Compute the multiplicative inverse of the current BigNumber in the modulus field specified by `p`.
     * The multiplicative inverse is a number which when multiplied with the current BigNumber gives '1' in the modulus field.
     *
     * @method _invmp
     * @param p - The `BigNumber` specifying the modulus field.
     * @returns The multiplicative inverse `BigNumber` in the modulus field specified by `p`.
     */
    /**
     * SECURITY NOTE:
     * This implementation avoids variable-time extended Euclidean algorithms
     * to reduce timing side-channel leakage. However, JavaScript BigInt arithmetic
     * does not provide constant-time guarantees. This implementation is suitable
     * for browser and single-tenant environments but is not hardened against
     * high-resolution timing attacks in shared CPU contexts.
    */
    _invmp(p) {
      this.assert(p._sign === 0, "p must not be negative for _invmp");
      this.assert(!p.isZero(), "p must not be zero for _invmp");
      const a = this.umod(p);
      const exp = p.subn(2);
      if (a.red !== null) {
        return a.redPow(exp);
      }
      let result = new _BigNumber(1n);
      let base = a.clone();
      const e = exp.clone();
      while (!e.isZero()) {
        if (e.isOdd())
          result = result.mul(base).umod(p);
        base = base.sqr().umod(p);
        e.iushrn(1);
      }
      return result;
    }
    /**
     * Performs multiplication between the BigNumber instance and a given BigNumber.
     * It chooses the multiplication method based on the lengths of the numbers to optimize execution time.
     *
     * @method mulTo
     * @param num - The BigNumber multiply with.
     * @param out - The BigNumber where to store the result.
     * @returns The BigNumber resulting from the multiplication operation.
     */
    mulTo(num, out) {
      out._magnitude = this._magnitude * num._magnitude;
      out._sign = out._magnitude === 0n ? 0 : this._sign ^ num._sign;
      out._nominalWordLength = this.length + num.length;
      out.red = null;
      out.normSign();
      return out;
    }
  };
  /**
   * @privateinitializer
   */
  __publicField(_BigNumber, "zeros", [
    "",
    "0",
    "00",
    "000",
    "0000",
    "00000",
    "000000",
    "0000000",
    "00000000",
    "000000000",
    "0000000000",
    "00000000000",
    "000000000000",
    "0000000000000",
    "00000000000000",
    "000000000000000",
    "0000000000000000",
    "00000000000000000",
    "000000000000000000",
    "0000000000000000000",
    "00000000000000000000",
    "000000000000000000000",
    "0000000000000000000000",
    "00000000000000000000000",
    "000000000000000000000000",
    "0000000000000000000000000"
  ]);
  /**
   * @privateinitializer
   */
  __publicField(_BigNumber, "groupSizes", [
    0,
    0,
    25,
    16,
    12,
    11,
    10,
    9,
    8,
    8,
    7,
    7,
    7,
    7,
    6,
    6,
    6,
    6,
    6,
    6,
    6,
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    5
  ]);
  /**
   * @privateinitializer
   */
  __publicField(_BigNumber, "groupBases", [
    0,
    0,
    33554432,
    43046721,
    16777216,
    48828125,
    60466176,
    40353607,
    16777216,
    43046721,
    1e7,
    19487171,
    35831808,
    62748517,
    7529536,
    11390625,
    16777216,
    24137569,
    34012224,
    47045881,
    64e6,
    4084101,
    5153632,
    6436343,
    7962624,
    9765625,
    11881376,
    14348907,
    17210368,
    20511149,
    243e5,
    28629151,
    33554432,
    39135393,
    45435424,
    52521875,
    60466176
  ]);
  /**
   * The word size of big number chunks.
   *
   * @property wordSize
   *
   * @example
   * console.log(BigNumber.wordSize);  // output: 26
   */
  __publicField(_BigNumber, "wordSize", 26);
  __publicField(_BigNumber, "WORD_SIZE_BIGINT", BigInt(_BigNumber.wordSize));
  __publicField(_BigNumber, "WORD_MASK", (1n << _BigNumber.WORD_SIZE_BIGINT) - 1n);
  __publicField(_BigNumber, "MAX_SAFE_INTEGER_BIGINT", BigInt(Number.MAX_SAFE_INTEGER));
  __publicField(_BigNumber, "MIN_SAFE_INTEGER_BIGINT", BigInt(Number.MIN_SAFE_INTEGER));
  __publicField(_BigNumber, "MAX_IMULN_ARG", 67108864 - 1);
  __publicField(_BigNumber, "MAX_NUMBER_CONSTRUCTOR_MAG_BIGINT", (1n << 53n) - 1n);
  var BigNumber = _BigNumber;

  // node_modules/@bsv/sdk/dist/esm/src/primitives/Mersenne.js
  var Mersenne = class {
    /**
     * @constructor
     * @param name - An identifier for the Mersenne instance.
     * @param p - A string representation of the pseudo-Mersenne prime, expressed in hexadecimal.
     *
     * @example
     * const mersenne = new Mersenne('M31', '7FFFFFFF');
     */
    constructor(name, p) {
      __publicField(this, "name");
      __publicField(this, "p");
      __publicField(this, "k");
      __publicField(this, "n");
      __publicField(this, "tmp");
      this.name = name;
      this.p = new BigNumber(p, 16);
      this.n = this.p.bitLength();
      this.k = new BigNumber(BigInt(1)).iushln(this.n).isub(this.p);
      this.tmp = this._tmp();
    }
    /**
     * Creates a temporary BigNumber structure for computations,
     * ensuring the appropriate number of words are initially allocated.
     *
     * @method _tmp
     * @returns A BigNumber with scaled size depending on prime magnitude.
     */
    _tmp() {
      const tmp = new BigNumber(BigInt(0));
      const requiredWords = Math.ceil(this.n / BigNumber.wordSize);
      tmp.expand(Math.max(1, requiredWords));
      return tmp;
    }
    /**
     * Reduces an input BigNumber in place, under the assumption that
     * it is less than the square of the pseudo-Mersenne prime.
     *
     * @method ireduce
     * @param num - The BigNumber to be reduced.
     * @returns The reduced BigNumber.
     *
     * @example
     * const reduced = mersenne.ireduce(new BigNumber('2345', 16));
     */
    ireduce(num) {
      const r2 = num;
      let rlen;
      do {
        this.split(r2, this.tmp);
        this.imulK(r2);
        r2.iadd(this.tmp);
        rlen = r2.bitLength();
      } while (rlen > this.n);
      const cmp = rlen < this.n ? -1 : r2.ucmp(this.p);
      if (cmp === 0) {
        r2.words = [0];
      } else if (cmp > 0) {
        r2.isub(this.p);
      }
      r2.strip();
      return r2;
    }
    /**
     * Shifts bits of the input BigNumber to the right, in place,
     * to meet the magnitude of the pseudo-Mersenne prime.
     *
     * @method split
     * @param input - The BigNumber to be shifted (will contain HI part).
     * @param out - The BigNumber to hold the shifted result (LO part).
     *
     * @example
     * mersenne.split(new BigNumber('2345', 16), new BigNumber());
     */
    split(input, out) {
      input.iushrn(this.n, 0, out);
    }
    /**
     * Performs an in-place multiplication of the parameter by constant k.
     *
     * @method imulK
     * @param num - The BigNumber to multiply with k.
     * @returns The result of the multiplication, in BigNumber format.
     *
     * @example
     * const multiplied = mersenne.imulK(new BigNumber('2345', 16));
     */
    imulK(num) {
      return num.imul(this.k);
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/K256.js
  var K256 = class extends Mersenne {
    /**
     * Constructor for the K256 class.
     * Creates an instance of K256 using the super constructor from Mersenne.
     *
     * @constructor
     *
     * @example
     * const k256 = new K256();
     */
    constructor() {
      super("k256", "ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff fffffffe fffffc2f");
    }
    /**
     * Splits a BigNumber into a new BigNumber based on specific computation
     * rules. This method modifies the input and output big numbers.
     *
     * @method split
     * @param input - The BigNumber to be split.
     * @param output - The BigNumber that results from the split.
     *
     * @example
     * const input = new BigNumber(3456);
     * const output = new BigNumber(0);
     * k256.split(input, output);
     */
    split(input, output) {
      const mask = 4194303;
      const inputWords = input.words;
      const inputNominalLength = input.length;
      const outLen = Math.min(inputNominalLength, 9);
      const tempOutputWords = new Array(outLen + (inputNominalLength > 9 ? 1 : 0)).fill(0);
      for (let i = 0; i < outLen; i++) {
        tempOutputWords[i] = inputWords[i];
      }
      let currentOutputWordCount = outLen;
      if (inputNominalLength <= 9) {
        const finalOutputWords2 = new Array(currentOutputWordCount);
        for (let i = 0; i < currentOutputWordCount; ++i)
          finalOutputWords2[i] = tempOutputWords[i];
        output.words = finalOutputWords2;
        input.words = [0];
        return;
      }
      let prev = inputWords[9];
      tempOutputWords[currentOutputWordCount++] = prev & mask;
      const finalOutputWords = new Array(currentOutputWordCount);
      for (let i = 0; i < currentOutputWordCount; ++i)
        finalOutputWords[i] = tempOutputWords[i];
      output.words = finalOutputWords;
      const tempInputNewWords = new Array(Math.max(1, inputNominalLength - 9)).fill(0);
      let currentInputNewWordCount = 0;
      for (let i = 10; i < inputNominalLength; i++) {
        const next = Math.trunc(inputWords[i]);
        if (currentInputNewWordCount < tempInputNewWords.length) {
          tempInputNewWords[currentInputNewWordCount++] = (next & mask) << 4 | prev >>> 22;
        }
        prev = next;
      }
      prev >>>= 22;
      if (currentInputNewWordCount < tempInputNewWords.length) {
        tempInputNewWords[currentInputNewWordCount++] = prev;
      } else if (prev !== 0 && tempInputNewWords.length > 0) {
      }
      const finalInputNewWords = new Array(currentInputNewWordCount);
      for (let i = 0; i < currentInputNewWordCount; ++i)
        finalInputNewWords[i] = tempInputNewWords[i];
      input.words = finalInputNewWords;
    }
    /**
     * Multiplies a BigNumber ('num') with the constant 'K' in-place and returns the result.
     * 'K' is equal to 0x1000003d1 or in decimal representation: [ 64, 977 ].
     *
     * @method imulK
     * @param num - The BigNumber to multiply with K.
     * @returns Returns the mutated BigNumber after multiplication.
     *
     * @example
     * const number = new BigNumber(12345);
     * const result = k256.imulK(number);
     */
    imulK(num) {
      const currentWords = num.words;
      const originalNominalLength = num.length;
      const newNominalLength = originalNominalLength + 2;
      const tempWords = new Array(newNominalLength).fill(0);
      for (let i = 0; i < originalNominalLength; i++) {
        tempWords[i] = currentWords[i];
      }
      let lo = 0;
      for (let i = 0; i < newNominalLength; i++) {
        const w = Math.trunc(tempWords[i]);
        lo += w * 977;
        tempWords[i] = lo & 67108863;
        lo = w * 64 + Math.trunc(lo / 67108864);
      }
      num.words = tempWords;
      return num;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/ReductionContext.js
  var ReductionContext = class {
    /**
     * Constructs a new ReductionContext.
     *
     * @constructor
     * @param m - A BigNumber representing the modulus, or 'k256' to create a context for Koblitz curve.
     *
     * @example
     * new ReductionContext(new BigNumber(11));
     * new ReductionContext('k256');
     */
    constructor(m) {
      __publicField(this, "prime");
      __publicField(this, "m");
      if (m === "k256") {
        const prime = new K256();
        this.m = prime.p;
        this.prime = prime;
      } else {
        this.assert(m.gtn(1), "modulus must be greater than 1");
        this.m = m;
        this.prime = null;
      }
    }
    /**
     * Asserts that given value is truthy. Throws an Error with a provided message
     * if the value is falsy.
     *
     * @private
     * @param val - The value to be checked.
     * @param msg - The error message to be thrown if the value is falsy.
     *
     * @example
     * this.assert(1 < 2, '1 is not less than 2');
     * this.assert(2 < 1, '2 is less than 1'); // throws an Error with message '2 is less than 1'
     */
    assert(val2, msg = "Assertion failed") {
      if (!val2)
        throw new Error(msg);
    }
    /**
     * Verifies that a BigNumber is positive and red. Throws an error if these
     * conditions are not met.
     *
     * @param a - The BigNumber to be verified.
     *
     * @example
     * this.verify1(new BigNumber(10).toRed());
     * this.verify1(new BigNumber(-10).toRed()); //throws an Error
     * this.verify1(new BigNumber(10)); //throws an Error
     */
    verify1(a) {
      this.assert(a.negative === 0, "red works only with positives");
      this.assert(a.red, "red works only with red numbers");
    }
    /**
     * Verifies that two BigNumbers are both positive and red. Also checks
     * that they have the same reduction context. Throws an error if these
     * conditions are not met.
     *
     * @param a - The first BigNumber to be verified.
     * @param b - The second BigNumber to be verified.
     *
     * @example
     * this.verify2(new BigNumber(10).toRed(this), new BigNumber(20).toRed(this));
     * this.verify2(new BigNumber(-10).toRed(this), new BigNumber(20).toRed(this)); //throws an Error
     * this.verify2(new BigNumber(10).toRed(this), new BigNumber(20)); //throws an Error
     */
    verify2(a, b) {
      this.assert((a.negative | b.negative) === 0, "red works only with positives");
      this.assert(a.red != null && a.red === b.red, "red works only with red numbers");
    }
    /**
     * Performs an in-place reduction of the given BigNumber by the modulus of the reduction context, 'm'.
     *
     * @method imod
     *
     * @param a - BigNumber to be reduced.
     *
     * @returns Returns the reduced result.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(7));
     * context.imod(new BigNumber(19)); // Returns 5
     */
    imod(a) {
      if (this.prime != null)
        return this.prime.ireduce(a).forceRed(this);
      BigNumber.move(a, a.umod(this.m).forceRed(this));
      return a;
    }
    /**
     * Negates a BigNumber in the context of the modulus.
     *
     * @method neg
     *
     * @param a - BigNumber to negate.
     *
     * @returns Returns the negation of 'a' in the reduction context.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(7));
     * context.neg(new BigNumber(3)); // Returns 4
     */
    neg(a) {
      if (a.isZero()) {
        return a.clone();
      }
      return this.m.sub(a).forceRed(this);
    }
    /**
     * Performs the addition operation on two BigNumbers in the reduction context.
     *
     * @method add
     *
     * @param a - First BigNumber to add.
     * @param b - Second BigNumber to add.
     *
     * @returns Returns the result of 'a + b' in the reduction context.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(5));
     * context.add(new BigNumber(2), new BigNumber(4)); // Returns 1
     */
    add(a, b) {
      this.verify2(a, b);
      const res = a.clone();
      res.iadd(b);
      res.isub(this.m);
      if (res.isNeg()) {
        res.iadd(this.m);
      }
      return res;
    }
    /**
     * Performs an in-place addition operation on two BigNumbers in the reduction context
     * in order to avoid creating a new BigNumber, it modifies the first one with the result.
     *
     * @method iadd
     *
     * @param a - First BigNumber to add.
     * @param b - Second BigNumber to add.
     *
     * @returns Returns the modified 'a' after addition with 'b' in the reduction context.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(5));
     * const a = new BigNumber(2);
     * context.iadd(a, new BigNumber(4)); // Modifies 'a' to be 1
     */
    iadd(a, b) {
      this.verify2(a, b);
      a.iadd(b);
      a.isub(this.m);
      if (a.isNeg()) {
        a.iadd(this.m);
      }
      return a;
    }
    /**
     * Subtracts one BigNumber from another BigNumber in the reduction context.
     *
     * @method sub
     *
     * @param a - BigNumber to be subtracted from.
     * @param b - BigNumber to subtract.
     *
     * @returns Returns the result of 'a - b' in the reduction context.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(7));
     * context.sub(new BigNumber(3), new BigNumber(2)); // Returns 1
     */
    sub(a, b) {
      this.verify2(a, b);
      const res = a.sub(b);
      if (res.cmpn(0) < 0) {
        res.iadd(this.m);
      }
      return res.forceRed(this);
    }
    /**
     * Performs in-place subtraction of one BigNumber from another in the reduction context,
     * it modifies the first BigNumber with the result.
     *
     * @method isub
     *
     * @param a - BigNumber to be subtracted from.
     * @param b - BigNumber to subtract.
     *
     * @returns Returns the modified 'a' after subtraction of 'b' in the reduction context.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(5));
     * const a = new BigNumber(4);
     * context.isub(a, new BigNumber(2)); // Modifies 'a' to be 2
     */
    isub(a, b) {
      this.verify2(a, b);
      const res = a.isub(b);
      if (res.cmpn(0) < 0) {
        res.iadd(this.m);
      }
      return res;
    }
    /**
     * Performs bitwise shift left operation on a BigNumber in the reduction context.
     *
     * @method shl
     *
     * @param a - BigNumber to perform shift on.
     * @param num - The number of positions to shift.
     *
     * @returns Returns the result of shifting 'a' left by 'num' positions in the reduction context.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(32));
     * context.shl(new BigNumber(4), 2); // Returns 16
     */
    shl(a, num) {
      this.verify1(a);
      return this.imod(a.ushln(num));
    }
    /**
     * Performs in-place multiplication of two BigNumbers in the reduction context,
     * modifying the first BigNumber with the result.
     *
     * @method imul
     *
     * @param a - First BigNumber to multiply.
     * @param b - Second BigNumber to multiply.
     *
     * @returns Returns the modified 'a' after multiplication with 'b' in the reduction context.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(7));
     * const a = new BigNumber(3);
     * context.imul(a, new BigNumber(2)); // Modifies 'a' to be 6
     */
    imul(a, b) {
      this.verify2(a, b);
      return this.imod(a.imul(b));
    }
    /**
     * Multiplies two BigNumbers in the reduction context.
     *
     * @method mul
     *
     * @param a - First BigNumber to multiply.
     * @param b - Second BigNumber to multiply.
     *
     * @returns Returns the result of 'a * b' in the reduction context.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(7));
     * context.mul(new BigNumber(3), new BigNumber(2)); // Returns 6
     */
    mul(a, b) {
      this.verify2(a, b);
      return this.imod(a.mul(b));
    }
    /**
     * Calculates the square of a BigNumber in the reduction context,
     * modifying the original BigNumber with the result.
     *
     * @method isqr
     *
     * @param a - BigNumber to be squared.
     *
     * @returns Returns the squared 'a' in the reduction context.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(7));
     * const a = new BigNumber(3);
     * context.isqr(a); // Modifies 'a' to be 2 (9 % 7 = 2)
     */
    isqr(a) {
      return this.imul(a, a.clone());
    }
    /**
     * Calculates the square of a BigNumber in the reduction context.
     *
     * @method sqr
     *
     * @param a - BigNumber to be squared.
     *
     * @returns Returns the result of 'a^2' in the reduction context.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(7));
     * context.sqr(new BigNumber(3)); // Returns 2 (9 % 7 = 2)
     */
    sqr(a) {
      return this.mul(a, a);
    }
    /**
     * Calculates the square root of a BigNumber in the reduction context.
     *
     * @method sqrt
     *
     * @param a - The BigNumber to calculate the square root of.
     *
     * @returns Returns the square root of 'a' in the reduction context.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(9));
     * context.sqrt(new BigNumber(4)); // Returns 2
     */
    sqrt(a) {
      if (a.isZero())
        return a.clone();
      const mod3 = this.m.andln(3);
      this.assert(mod3 % 2 === 1);
      if (mod3 === 3) {
        const pow = this.m.add(new BigNumber(1)).iushrn(2);
        return this.pow(a, pow);
      }
      const q = this.m.subn(1);
      let s2 = 0;
      while (!q.isZero() && q.andln(1) === 0) {
        s2++;
        q.iushrn(1);
      }
      this.assert(!q.isZero());
      const one = new BigNumber(1).toRed(this);
      const nOne = one.redNeg();
      const lpow = this.m.subn(1).iushrn(1);
      const zl = this.m.bitLength();
      const z = new BigNumber(2 * zl * zl).toRed(this);
      while (this.pow(z, lpow).cmp(nOne) !== 0) {
        z.redIAdd(nOne);
      }
      let c = this.pow(z, q);
      let r2 = this.pow(a, q.addn(1).iushrn(1));
      let t = this.pow(a, q);
      let m = s2;
      while (t.cmp(one) !== 0) {
        let tmp = t;
        let i = 0;
        for (; tmp.cmp(one) !== 0; i++) {
          tmp = tmp.redSqr();
        }
        this.assert(i < m);
        const b = this.pow(c, new BigNumber(1).iushln(m - i - 1));
        r2 = r2.redMul(b);
        c = b.redSqr();
        t = t.redMul(c);
        m = i;
      }
      return r2;
    }
    /**
     * Calculates the multiplicative inverse of a BigNumber in the reduction context.
     *
     * @method invm
     *
     * @param a - The BigNumber to find the multiplicative inverse of.
     *
     * @returns Returns the multiplicative inverse of 'a' in the reduction context.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(11));
     * context.invm(new BigNumber(3)); // Returns 4 (3*4 mod 11 = 1)
     */
    invm(a) {
      const inv = a._invmp(this.m);
      if (inv.negative !== 0) {
        inv.negative = 0;
        return this.imod(inv).redNeg();
      } else {
        return this.imod(inv);
      }
    }
    /**
     * Raises a BigNumber to a power in the reduction context.
     *
     * @method pow
     *
     * @param a - The BigNumber to be raised to a power.
     * @param num - The power to raise the BigNumber to.
     *
     * @returns Returns the result of 'a' raised to the power of 'num' in the reduction context.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(7));
     * context.pow(new BigNumber(3), new BigNumber(2)); // Returns 2 (3^2 % 7)
     */
    pow(a, num) {
      this.verify1(a);
      if (num.isZero())
        return new BigNumber(1).toRed(this);
      let result = new BigNumber(1).toRed(this);
      const base = a.clone();
      const bits = num.bitLength();
      for (let i = bits - 1; i >= 0; i--) {
        result = this.sqr(result);
        if (num.testn(i)) {
          result = this.mul(result, base);
        }
      }
      return result;
    }
    /**
     * Converts a BigNumber to its equivalent in the reduction context.
     *
     * @method convertTo
     *
     * @param num - The BigNumber to convert to the reduction context.
     *
     * @returns Returns the converted BigNumber compatible with the reduction context.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(7));
     * context.convertTo(new BigNumber(8)); // Returns 1 (8 % 7)
     */
    convertTo(num) {
      const r2 = num.umod(this.m);
      return r2 === num ? r2.clone() : r2;
    }
    /**
     * Converts a BigNumber from reduction context to its regular form.
     *
     * @method convertFrom
     *
     * @param num - The BigNumber to convert from the reduction context.
     *
     * @returns Returns the converted BigNumber in its regular form.
     *
     * @example
     * const context = new ReductionContext(new BigNumber(7));
     * const a = context.convertTo(new BigNumber(8)); // 'a' is now 1 in the reduction context
     * context.convertFrom(a); // Returns 1
     */
    convertFrom(num) {
      const res = num.clone();
      res.red = null;
      return res;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/MontgomoryMethod.js
  var MontgomoryMethod = class extends ReductionContext {
    /**
     * @constructor
     * @param m - The modulus to be used for the Montgomery method reductions.
     */
    constructor(m) {
      super(m);
      __publicField(this, "shift");
      __publicField(this, "r");
      __publicField(this, "r2");
      __publicField(this, "rinv");
      __publicField(this, "minv");
      this.shift = this.m.bitLength();
      if (this.shift % 26 !== 0) {
        this.shift += 26 - this.shift % 26;
      }
      this.r = new BigNumber(1).iushln(this.shift);
      this.r2 = this.imod(this.r.sqr());
      this.rinv = this.r._invmp(this.m);
      this.minv = this.rinv.mul(this.r).isubn(1).div(this.m);
      this.minv = this.minv.umod(this.r);
      this.minv = this.r.sub(this.minv);
    }
    /**
     * Converts a number into the Montgomery domain.
     *
     * @method convertTo
     * @param num - The number to be converted into the Montgomery domain.
     * @returns The result of the conversion into the Montgomery domain.
     *
     * @example
     * const montMethod = new MontgomoryMethod(m);
     * const convertedNum = montMethod.convertTo(num);
     */
    convertTo(num) {
      return this.imod(num.ushln(this.shift));
    }
    /**
     * Converts a number from the Montgomery domain back to the original domain.
     *
     * @method convertFrom
     * @param num - The number to be converted from the Montgomery domain.
     * @returns The result of the conversion from the Montgomery domain.
     *
     * @example
     * const montMethod = new MontgomoryMethod(m);
     * const convertedNum = montMethod.convertFrom(num);
     */
    convertFrom(num) {
      const r2 = this.imod(num.mul(this.rinv));
      r2.red = null;
      return r2;
    }
    /**
     * Performs an in-place multiplication of two numbers in the Montgomery domain.
     *
     * @method imul
     * @param a - The first number to multiply.
     * @param b - The second number to multiply.
     * @returns The result of the in-place multiplication.
     *
     * @example
     * const montMethod = new MontgomoryMethod(m);
     * const product = montMethod.imul(a, b);
     */
    imul(a, b) {
      if (a.isZero() || b.isZero()) {
        a.words[0] = 0;
        a.length = 1;
        return a;
      }
      const t = a.imul(b);
      const c = t.maskn(this.shift).mul(this.minv).imaskn(this.shift).mul(this.m);
      const u = t.isub(c).iushrn(this.shift);
      let res = u;
      if (u.cmp(this.m) >= 0) {
        res = u.isub(this.m);
      } else if (u.cmpn(0) < 0) {
        res = u.iadd(this.m);
      }
      return res.forceRed(this);
    }
    /**
     * Performs the multiplication of two numbers in the Montgomery domain.
     *
     * @method mul
     * @param a - The first number to multiply.
     * @param b - The second number to multiply.
     * @returns The result of the multiplication.
     *
     * @example
     * const montMethod = new MontgomoryMethod(m);
     * const product = montMethod.mul(a, b);
     */
    mul(a, b) {
      if (a.isZero() || b.isZero())
        return new BigNumber(0).forceRed(this);
      const t = a.mul(b);
      const c = t.maskn(this.shift).mul(this.minv).imaskn(this.shift).mul(this.m);
      const u = t.isub(c).iushrn(this.shift);
      let res = u;
      if (u.cmp(this.m) >= 0) {
        res = u.isub(this.m);
      } else if (u.cmpn(0) < 0) {
        res = u.iadd(this.m);
      }
      return res.forceRed(this);
    }
    /**
     * Calculates the modular multiplicative inverse of a number in the Montgomery domain.
     *
     * @method invm
     * @param a - The number to compute the modular multiplicative inverse of.
     * @returns The modular multiplicative inverse of 'a'.
     *
     * @example
     * const montMethod = new MontgomoryMethod(m);
     * const inverse = montMethod.invm(a);
     */
    invm(a) {
      const res = this.imod(a._invmp(this.m).mul(this.r2));
      return res.forceRed(this);
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/BasePoint.js
  var BasePoint = class {
    constructor(type) {
      __publicField(this, "curve");
      __publicField(this, "type");
      __publicField(this, "precomputed");
      this.curve = new Curve();
      this.type = type;
      this.precomputed = null;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/JacobianPoint.js
  var JacobianPoint = class _JacobianPoint extends BasePoint {
    /**
     * Constructs a new `JacobianPoint` instance.
     *
     * @param x - If `null`, the x-coordinate will default to the curve's defined 'one' constant.
     * If `x` is not a BigNumber, `x` will be converted to a `BigNumber` assuming it is a hex string.
     *
     * @param y - If `null`, the y-coordinate will default to the curve's defined 'one' constant.
     * If `y` is not a BigNumber, `y` will be converted to a `BigNumber` assuming it is a hex string.
     *
     * @param z - If `null`, the z-coordinate will default to 0.
     * If `z` is not a BigNumber, `z` will be converted to a `BigNumber` assuming it is a hex string.
     *
     * @example
     * const pointJ1 = new JacobianPoint(null, null, null); // creates point at infinity
     * const pointJ2 = new JacobianPoint('3', '4', '1'); // creates point (3, 4, 1)
     */
    constructor(x, y, z) {
      super("jacobian");
      __publicField(this, "x");
      __publicField(this, "y");
      __publicField(this, "z");
      __publicField(this, "zOne");
      if (x === null && y === null && z === null) {
        this.x = this.curve.one;
        this.y = this.curve.one;
        this.z = new BigNumber(0);
      } else {
        if (!BigNumber.isBN(x)) {
          x = new BigNumber(x, 16);
        }
        this.x = x;
        if (!BigNumber.isBN(y)) {
          y = new BigNumber(y, 16);
        }
        this.y = y;
        if (!BigNumber.isBN(z)) {
          z = new BigNumber(z, 16);
        }
        this.z = z;
      }
      if (this.x.red == null) {
        this.x = this.x.toRed(this.curve.red);
      }
      if (this.y.red == null) {
        this.y = this.y.toRed(this.curve.red);
      }
      if (this.z.red == null) {
        this.z = this.z.toRed(this.curve.red);
      }
      this.zOne = this.z === this.curve.one;
      if (this.isInfinity()) {
        this.x = this.curve.one;
        this.y = this.curve.one;
        this.z = new BigNumber(0).toRed(this.curve.red);
        this.zOne = false;
      }
    }
    /**
     * Converts the `JacobianPoint` object instance to standard affine `Point` format and returns `Point` type.
     *
     * @returns The `Point`(affine) object representing the same point as the original `JacobianPoint`.
     *
     * If the initial `JacobianPoint` represents point at infinity, an instance of `Point` at infinity is returned.
     *
     * @example
     * const pointJ = new JacobianPoint('3', '4', '1');
     * const pointP = pointJ.toP();  // The point in affine coordinates.
     */
    toP() {
      if (this.isInfinity()) {
        return new Point(null, null);
      }
      const zinv = this.z.redInvm();
      const zinv2 = zinv.redSqr();
      const ax = this.x.redMul(zinv2);
      const ay = this.y.redMul(zinv2).redMul(zinv);
      return new Point(ax, ay);
    }
    /**
     * Negation operation. It returns the additive inverse of the Jacobian point.
     *
     * @method neg
     * @returns Returns a new Jacobian point as the result of the negation.
     *
     * @example
     * const jp = new JacobianPoint(x, y, z)
     * const result = jp.neg()
     */
    neg() {
      return new _JacobianPoint(this.x, this.y.redNeg(), this.z);
    }
    /**
     * Addition operation in the Jacobian coordinates. It takes a Jacobian point as an argument
     * and returns a new Jacobian point as a result of the addition. In the special cases,
     * when either one of the points is the point at infinity, it will return the other point.
     *
     * @method add
     * @param p - The Jacobian point to be added.
     * @returns Returns a new Jacobian point as the result of the addition.
     *
     * @example
     * const p1 = new JacobianPoint(x1, y1, z1)
     * const p2 = new JacobianPoint(x2, y2, z2)
     * const result = p1.add(p2)
     */
    add(p) {
      if (this.isInfinity()) {
        return p;
      }
      if (p.isInfinity()) {
        return this;
      }
      const pz2 = p.z.redSqr();
      const z2 = this.z.redSqr();
      const u1 = this.x.redMul(pz2);
      const u2 = p.x.redMul(z2);
      const s1 = this.y.redMul(pz2.redMul(p.z));
      const s2 = p.y.redMul(z2.redMul(this.z));
      const h = u1.redSub(u2);
      const r2 = s1.redSub(s2);
      if (h.cmpn(0) === 0) {
        if (r2.cmpn(0) === 0) {
          return this.dbl();
        } else {
          return new _JacobianPoint(null, null, null);
        }
      }
      const h2 = h.redSqr();
      const h3 = h2.redMul(h);
      const v = u1.redMul(h2);
      const nx = r2.redSqr().redIAdd(h3).redISub(v).redISub(v);
      const ny = r2.redMul(v.redISub(nx)).redISub(s1.redMul(h3));
      const nz = this.z.redMul(p.z).redMul(h);
      return new _JacobianPoint(nx, ny, nz);
    }
    /**
     * Mixed addition operation. This function combines the standard point addition with
     * the transformation from the affine to Jacobian coordinates. It first converts
     * the affine point to Jacobian, and then preforms the addition.
     *
     * @method mixedAdd
     * @param p - The affine point to be added.
     * @returns Returns the result of the mixed addition as a new Jacobian point.
     *
     * @example
     * const jp = new JacobianPoint(x1, y1, z1)
     * const ap = new Point(x2, y2)
     * const result = jp.mixedAdd(ap)
     */
    mixedAdd(p) {
      if (this.isInfinity()) {
        return p.toJ();
      }
      if (p.isInfinity()) {
        return this;
      }
      if (p.x === null || p.y === null) {
        throw new Error("Point coordinates cannot be null");
      }
      const z2 = this.z.redSqr();
      const u1 = this.x;
      const u2 = p.x.redMul(z2);
      const s1 = this.y;
      const s2 = p.y.redMul(z2).redMul(this.z);
      const h = u1.redSub(u2);
      const r2 = s1.redSub(s2);
      if (h.cmpn(0) === 0) {
        if (r2.cmpn(0) === 0) {
          return this.dbl();
        } else {
          return new _JacobianPoint(null, null, null);
        }
      }
      const h2 = h.redSqr();
      const h3 = h2.redMul(h);
      const v = u1.redMul(h2);
      const nx = r2.redSqr().redIAdd(h3).redISub(v).redISub(v);
      const ny = r2.redMul(v.redISub(nx)).redISub(s1.redMul(h3));
      const nz = this.z.redMul(h);
      return new _JacobianPoint(nx, ny, nz);
    }
    /**
     * Multiple doubling operation. It doubles the Jacobian point as many times as the pow parameter specifies. If pow is 0 or the point is the point at infinity, it will return the point itself.
     *
     * @method dblp
     * @param pow - The number of times the point should be doubled.
     * @returns Returns a new Jacobian point as the result of multiple doublings.
     *
     * @example
     * const jp = new JacobianPoint(x, y, z)
     * const result = jp.dblp(3)
     */
    dblp(pow) {
      if (pow === 0) {
        return this;
      }
      if (this.isInfinity()) {
        return this;
      }
      if (pow === void 0) {
        return this.dbl();
      }
      let r2 = this;
      for (let i = 0; i < pow; i++) {
        r2 = r2.dbl();
      }
      return r2;
    }
    /**
     * Point doubling operation in the Jacobian coordinates. A special case is when the point is the point at infinity, in this case, this function will return the point itself.
     *
     * @method dbl
     * @returns Returns a new Jacobian point as the result of the doubling.
     *
     * @example
     * const jp = new JacobianPoint(x, y, z)
     * const result = jp.dbl()
     */
    dbl() {
      if (this.isInfinity()) {
        return this;
      }
      let nx;
      let ny;
      let nz;
      if (this.zOne) {
        const xx = this.x.redSqr();
        const yy = this.y.redSqr();
        const yyyy = yy.redSqr();
        let s2 = this.x.redAdd(yy).redSqr().redISub(xx).redISub(yyyy);
        s2 = s2.redIAdd(s2);
        const m = xx.redAdd(xx).redIAdd(xx);
        const t = m.redSqr().redISub(s2).redISub(s2);
        let yyyy8 = yyyy.redIAdd(yyyy);
        yyyy8 = yyyy8.redIAdd(yyyy8);
        yyyy8 = yyyy8.redIAdd(yyyy8);
        nx = t;
        ny = m.redMul(s2.redISub(t)).redISub(yyyy8);
        nz = this.y.redAdd(this.y);
      } else {
        const a = this.x.redSqr();
        const b = this.y.redSqr();
        const c = b.redSqr();
        let d = this.x.redAdd(b).redSqr().redISub(a).redISub(c);
        d = d.redIAdd(d);
        const e = a.redAdd(a).redIAdd(a);
        const f2 = e.redSqr();
        let c8 = c.redIAdd(c);
        c8 = c8.redIAdd(c8);
        c8 = c8.redIAdd(c8);
        nx = f2.redISub(d).redISub(d);
        ny = e.redMul(d.redISub(nx)).redISub(c8);
        nz = this.y.redMul(this.z);
        nz = nz.redIAdd(nz);
      }
      return new _JacobianPoint(nx, ny, nz);
    }
    /**
     * Equality check operation. It checks whether the affine or Jacobian point is equal to this Jacobian point.
     *
     * @method eq
     * @param p - The affine or Jacobian point to compare with.
     * @returns Returns true if the points are equal, otherwise returns false.
     *
     * @example
     * const jp1 = new JacobianPoint(x1, y1, z1)
     * const jp2 = new JacobianPoint(x2, y2, z2)
     * const areEqual = jp1.eq(jp2)
     */
    eq(p) {
      if (p.type === "affine") {
        return this.eq(p.toJ());
      }
      if (this === p) {
        return true;
      }
      p = p;
      if (this.isInfinity() && p.isInfinity()) {
        return true;
      }
      if (this.isInfinity() !== p.isInfinity()) {
        return false;
      }
      const z2 = this.z.redSqr();
      const pz2 = p.z.redSqr();
      if (this.x.redMul(pz2).redISub(p.x.redMul(z2)).cmpn(0) !== 0) {
        return false;
      }
      const z3 = z2.redMul(this.z);
      const pz3 = pz2.redMul(p.z);
      return this.y.redMul(pz3).redISub(p.y.redMul(z3)).cmpn(0) === 0;
    }
    /**
     * Equality check operation in relation to an x coordinate of a point in projective coordinates.
     * It checks whether the x coordinate of the Jacobian point is equal to the provided x coordinate
     * of a point in projective coordinates.
     *
     * @method eqXToP
     * @param x - The x coordinate of a point in projective coordinates.
     * @returns Returns true if the x coordinates are equal, otherwise returns false.
     *
     * @example
     * const jp = new JacobianPoint(x1, y1, z1)
     * const isXEqual = jp.eqXToP(x2)
     */
    eqXToP(x) {
      const zs = this.z.redSqr();
      const rx = x.toRed(this.curve?.red).redMul(zs);
      if (this.x.cmp(rx) === 0) {
        return true;
      }
      const xc = x.clone();
      if (this.curve?.redN == null) {
        throw new Error("Curve or redN is not initialized.");
      }
      const t = this.curve.redN.redMul(zs);
      while (xc.cmp(this.curve.p) < 0) {
        xc.iadd(this.curve.n);
        if (xc.cmp(this.curve.p) >= 0) {
          return false;
        }
        rx.redIAdd(t);
        if (this.x.cmp(rx) === 0) {
          return true;
        }
      }
      return false;
    }
    /**
     * Returns the string representation of the JacobianPoint instance.
     * @method inspect
     * @returns Returns the string description of the JacobianPoint. If the JacobianPoint represents a point at infinity, the return value of this function is '<EC JPoint Infinity>'. For a normal point, it returns the string description format as '<EC JPoint x: x-coordinate y: y-coordinate z: z-coordinate>'.
     *
     * @example
     * const point = new JacobianPoint('5', '6', '1');
     * console.log(point.inspect()); // Output: '<EC JPoint x: 5 y: 6 z: 1>'
     */
    inspect() {
      if (this.isInfinity()) {
        return "<EC JPoint Infinity>";
      }
      return "<EC JPoint x: " + this.x.toString(16, 2) + " y: " + this.y.toString(16, 2) + " z: " + this.z.toString(16, 2) + ">";
    }
    /**
     * Checks whether the JacobianPoint instance represents a point at infinity.
     * @method isInfinity
     * @returns Returns true if the JacobianPoint's z-coordinate equals to zero (which represents the point at infinity in Jacobian coordinates). Returns false otherwise.
     *
     * @example
     * const point = new JacobianPoint('5', '6', '0');
     * console.log(point.isInfinity()); // Output: true
     */
    isInfinity() {
      return this.z.cmpn(0) === 0;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/utils.js
  var utils_exports = {};
  __export(utils_exports, {
    Reader: () => Reader,
    ReaderUint8Array: () => ReaderUint8Array,
    Writer: () => Writer,
    WriterUint8Array: () => WriterUint8Array,
    base64ToArray: () => base64ToArray,
    constantTimeEquals: () => constantTimeEquals,
    encode: () => encode,
    fromBase58: () => fromBase58,
    fromBase58Check: () => fromBase58Check,
    minimallyEncode: () => minimallyEncode,
    toArray: () => toArray2,
    toBase58: () => toBase58,
    toBase58Check: () => toBase58Check,
    toBase64: () => toBase64,
    toHex: () => toHex,
    toUTF8: () => toUTF8,
    toUint8Array: () => toUint8Array,
    verifyNotNull: () => verifyNotNull,
    zero2: () => zero2
  });

  // node_modules/@bsv/sdk/dist/esm/src/primitives/Hash.js
  var Hash_exports = {};
  __export(Hash_exports, {
    RIPEMD160: () => RIPEMD160,
    SHA1: () => SHA1,
    SHA1HMAC: () => SHA1HMAC,
    SHA256: () => SHA256,
    SHA256HMAC: () => SHA256HMAC,
    SHA512: () => SHA512,
    SHA512HMAC: () => SHA512HMAC,
    hash160: () => hash160,
    hash256: () => hash256,
    htonl: () => htonl,
    pbkdf2: () => pbkdf2,
    realHtonl: () => realHtonl,
    ripemd160: () => ripemd160,
    sha1: () => sha1,
    sha256: () => sha256,
    sha256hmac: () => sha256hmac,
    sha512: () => sha512,
    sha512hmac: () => sha512hmac,
    swapBytes32: () => swapBytes32,
    toArray: () => toArray
  });

  // node_modules/@bsv/sdk/dist/esm/src/primitives/hex.js
  var PURE_HEX_REGEX = /^[0-9a-fA-F]*$/;
  function assertValidHex(msg) {
    if (typeof msg !== "string") {
      throw new TypeError("Invalid hex string");
    }
    if (msg.length === 0)
      return;
    if (!PURE_HEX_REGEX.test(msg)) {
      throw new Error("Invalid hex string");
    }
  }
  function normalizeHex(msg) {
    assertValidHex(msg);
    if (msg.length === 0)
      return "";
    let normalized = msg.toLowerCase();
    if (normalized.length % 2 !== 0) {
      normalized = "0" + normalized;
    }
    return normalized;
  }

  // node_modules/@bsv/sdk/dist/esm/src/primitives/Hash.js
  var assert = (expression, message = "Hash assertion failed") => {
    if (!expression) {
      throw new Error(message);
    }
  };
  var BaseHash = class {
    constructor(blockSize, outSize, hmacStrength, padLength) {
      __publicField(this, "pending");
      __publicField(this, "pendingTotal");
      __publicField(this, "blockSize");
      __publicField(this, "outSize");
      __publicField(this, "endian");
      __publicField(this, "_delta8");
      __publicField(this, "_delta32");
      __publicField(this, "padLength");
      __publicField(this, "hmacStrength");
      this.pending = null;
      this.pendingTotal = 0;
      this.blockSize = blockSize;
      this.outSize = outSize;
      this.hmacStrength = hmacStrength;
      this.padLength = padLength / 8;
      this.endian = "big";
      this._delta8 = this.blockSize / 8;
      this._delta32 = this.blockSize / 32;
    }
    _update(msg, start) {
      throw new Error("Not implemented");
    }
    _digest() {
      throw new Error("Not implemented");
    }
    _digestHex() {
      throw new Error("Not implemented");
    }
    /**
     * Converts the input message into an array, pads it, and joins into 32bit blocks.
     * If there is enough data, it tries updating the hash computation.
     *
     * @method update
     * @param msg - The message segment to include in the hashing computation.
     * @param enc - The encoding of the message. If 'hex', the string will be treated as such, 'utf8' otherwise.
     *
     * @returns Returns the instance of the object for chaining.
     *
     * @example
     * sha256.update('Hello World', 'utf8');
     */
    update(msg, enc) {
      msg = toArray(msg, enc);
      if (this.pending == null) {
        this.pending = msg;
      } else {
        this.pending = this.pending.concat(msg);
      }
      this.pendingTotal += msg.length;
      if (this.pending.length >= this._delta8) {
        msg = this.pending;
        const r2 = msg.length % this._delta8;
        this.pending = msg.slice(msg.length - r2, msg.length);
        if (this.pending.length === 0) {
          this.pending = null;
        }
        msg = join32(msg, 0, msg.length - r2, this.endian);
        for (let i = 0; i < msg.length; i += this._delta32) {
          this._update(msg, i);
        }
      }
      return this;
    }
    /**
     * Finalizes the hash computation and returns the hash value/result.
     *
     * @method digest
     *
     * @returns Returns the final hash value.
     *
     * @example
     * const hash = sha256.digest();
     */
    digest() {
      this.update(this._pad());
      assert(this.pending === null);
      return this._digest();
    }
    /**
     * Finalizes the hash computation and returns the hash value/result as a hex string.
     *
     * @method digest
     *
     * @returns Returns the final hash value as a hex string.
     *
     * @example
     * const hash = sha256.digestHex();
     */
    digestHex() {
      this.update(this._pad());
      assert(this.pending === null);
      return this._digestHex();
    }
    /**
     * [Private Method] Used internally to prepare the padding for the final stage of the hash computation.
     *
     * @method _pad
     * @private
     *
     * @returns Returns an array denoting the padding.
     */
    _pad() {
      const len = this.pendingTotal;
      if (!Number.isSafeInteger(len) || len < 0) {
        throw new Error("Message too long for this hash function");
      }
      const bytes2 = this._delta8;
      const k = bytes2 - (len + this.padLength) % bytes2;
      const res = new Array(k + this.padLength);
      res[0] = 128;
      let i;
      for (i = 1; i < k; i++) {
        res[i] = 0;
      }
      const lengthBytes = this.padLength;
      const maxBits = 1n << BigInt(lengthBytes * 8);
      let totalBits = BigInt(len) * 8n;
      if (totalBits >= maxBits) {
        throw new Error("Message too long for this hash function");
      }
      if (this.endian === "big") {
        const lenArray = new Array(lengthBytes);
        for (let b = lengthBytes - 1; b >= 0; b--) {
          lenArray[b] = Number(totalBits & 0xffn);
          totalBits >>= 8n;
        }
        for (let b = 0; b < lengthBytes; b++) {
          res[i++] = lenArray[b];
        }
      } else {
        for (let b = 0; b < lengthBytes; b++) {
          res[i++] = Number(totalBits & 0xffn);
          totalBits >>= 8n;
        }
      }
      return res;
    }
  };
  function isSurrogatePair(msg, i) {
    if ((msg.charCodeAt(i) & 64512) !== 55296) {
      return false;
    }
    if (i < 0 || i + 1 >= msg.length) {
      return false;
    }
    return (msg.charCodeAt(i + 1) & 64512) === 56320;
  }
  function appendUtf8CodeUnit(msg, i, out) {
    let c = msg.charCodeAt(i);
    if (c < 128) {
      out.push(c);
      return i;
    }
    if (c < 2048) {
      out.push(c >> 6 | 192, c & 63 | 128);
      return i;
    }
    if (isSurrogatePair(msg, i)) {
      c = 65536 + ((c & 1023) << 10) + (msg.charCodeAt(i + 1) & 1023);
      out.push(c >> 18 | 240, c >> 12 & 63 | 128, c >> 6 & 63 | 128, c & 63 | 128);
      return i + 1;
    }
    out.push(c >> 12 | 224, c >> 6 & 63 | 128, c & 63 | 128);
    return i;
  }
  function utf8StringToArray(msg) {
    const res = [];
    for (let i = 0; i < msg.length; i++) {
      i = appendUtf8CodeUnit(msg, i, res);
    }
    return res;
  }
  function hexStringToArray(msg) {
    assertValidHex(msg);
    const normalized = normalizeHex(msg);
    const res = [];
    for (let i = 0; i < normalized.length; i += 2) {
      res.push(Number.parseInt(normalized[i] + normalized[i + 1], 16));
    }
    return res;
  }
  function numberArrayToByteArray(msg) {
    const res = [];
    for (let i = 0; i < msg.length; i++) {
      res[i] = Math.trunc(msg[i]);
    }
    return res;
  }
  function toArray(msg, enc) {
    if (Array.isArray(msg)) {
      return msg.slice();
    }
    if (!msg) {
      return [];
    }
    if (typeof msg === "string") {
      return enc === "hex" ? hexStringToArray(msg) : utf8StringToArray(msg);
    }
    return numberArrayToByteArray(msg);
  }
  function htonl(w) {
    return swapBytes32(w);
  }
  function toHex32(msg, endian) {
    let res = "";
    for (let w of msg) {
      if (endian === "little") {
        w = htonl(w);
      }
      res += zero8(w.toString(16));
    }
    return res;
  }
  function zero8(word) {
    if (word.length === 7) {
      return "0" + word;
    } else if (word.length === 6) {
      return "00" + word;
    } else if (word.length === 5) {
      return "000" + word;
    } else if (word.length === 4) {
      return "0000" + word;
    } else if (word.length === 3) {
      return "00000" + word;
    } else if (word.length === 2) {
      return "000000" + word;
    } else if (word.length === 1) {
      return "0000000" + word;
    } else {
      return word;
    }
  }
  var BufferCtor2 = typeof globalThis === "undefined" ? void 0 : globalThis.Buffer;
  var CAN_USE_BUFFER2 = BufferCtor2 != null && typeof BufferCtor2.from === "function";
  var HEX_DIGITS = "0123456789abcdef";
  var HEX_BYTE_STRINGS = new Array(256);
  for (let i = 0; i < HEX_BYTE_STRINGS.length; i++) {
    HEX_BYTE_STRINGS[i] = HEX_DIGITS[i >> 4 & 15] + HEX_DIGITS[i & 15];
  }
  function bytesToHex(data) {
    if (CAN_USE_BUFFER2) {
      return BufferCtor2.from(data).toString("hex");
    }
    const out = new Array(data.length);
    for (let i = 0; i < data.length; i++)
      out[i] = HEX_BYTE_STRINGS[data[i]];
    return out.join("");
  }
  var NODE_CRYPTO = (() => {
    const processLike = typeof globalThis === "undefined" ? void 0 : globalThis.process;
    const getBuiltinModule = processLike?.getBuiltinModule;
    if (typeof getBuiltinModule === "function") {
      try {
        const crypto = getBuiltinModule.call(processLike, "node:crypto");
        if (crypto != null)
          return crypto;
      } catch {
      }
    }
    try {
      if (typeof __require === "function") {
        return __require("node:crypto");
      }
    } catch {
    }
    return void 0;
  })();
  function toHashBytes(msg, enc) {
    if (msg instanceof Uint8Array) {
      return msg;
    }
    if (Array.isArray(msg)) {
      return new Uint8Array(msg);
    }
    return Uint8Array.from(toArray(msg, enc));
  }
  function toHashKeyBytes(key2) {
    return typeof key2 === "string" ? toHashBytes(key2, "hex") : toHashBytes(key2);
  }
  function updateNativeOrFallback(native, fallback, data) {
    if (native != null) {
      native.update(data);
    } else if (fallback != null) {
      fallback.update(data);
    }
  }
  function digestNativeOrFallback(native, fallback) {
    if (native != null)
      return Array.from(native.digest());
    if (fallback != null)
      return Array.from(fallback.digest());
    return [];
  }
  function digestHexNativeOrFallback(native, fallback) {
    if (native != null)
      return native.digest("hex");
    if (fallback != null)
      return bytesToHex(fallback.digest());
    return "";
  }
  function createNodeHash(algorithm) {
    const createHash = NODE_CRYPTO?.createHash;
    if (typeof createHash !== "function")
      return void 0;
    try {
      return createHash(algorithm);
    } catch {
      return void 0;
    }
  }
  function createNodeHmac(algorithm, keyBytes) {
    const createHmac = NODE_CRYPTO?.createHmac;
    if (typeof createHmac !== "function")
      return void 0;
    try {
      return createHmac(algorithm, keyBytes);
    } catch {
      return void 0;
    }
  }
  function digestWithNodeHash(algorithm, msg, enc) {
    const hash = createNodeHash(algorithm);
    if (hash == null)
      return void 0;
    hash.update(toHashBytes(msg, enc));
    return hash.digest();
  }
  function digestWithNodeHmac(algorithm, key2, msg, enc) {
    const hmac2 = createNodeHmac(algorithm, toHashKeyBytes(key2));
    if (hmac2 == null)
      return void 0;
    hmac2.update(toHashBytes(msg, enc));
    return hmac2.digest();
  }
  function join32(msg, start, end, endian) {
    const len = end - start;
    assert(len % 4 === 0);
    const res = new Array(len / 4);
    for (let i = 0, k = start; i < res.length; i++, k += 4) {
      let w;
      if (endian === "big") {
        w = msg[k] << 24 | msg[k + 1] << 16 | msg[k + 2] << 8 | msg[k + 3];
      } else {
        w = msg[k + 3] << 24 | msg[k + 2] << 16 | msg[k + 1] << 8 | msg[k];
      }
      res[i] = w >>> 0;
    }
    return res;
  }
  function split32(msg, endian) {
    const res = new Array(msg.length * 4);
    for (let i = 0, k = 0; i < msg.length; i++, k += 4) {
      const m = msg[i];
      if (endian === "big") {
        res[k] = m >>> 24;
        res[k + 1] = m >>> 16 & 255;
        res[k + 2] = m >>> 8 & 255;
        res[k + 3] = m & 255;
      } else {
        res[k + 3] = m >>> 24;
        res[k + 2] = m >>> 16 & 255;
        res[k + 1] = m >>> 8 & 255;
        res[k] = m & 255;
      }
    }
    return res;
  }
  function rotr32(w, b) {
    return w >>> b | w << 32 - b;
  }
  function rotl32(w, b) {
    return w << b | w >>> 32 - b;
  }
  function sum32(a, b) {
    return a + b >>> 0;
  }
  function SUM32_3(a, b, c) {
    return a + b + c >>> 0;
  }
  function SUM32_4(a, b, c, d) {
    return a + b + c + d >>> 0;
  }
  function SUM32_5(a, b, c, d, e) {
    return a + b + c + d + e >>> 0;
  }
  function FT_1(s2, x, y, z) {
    if (s2 === 0) {
      return ch32(x, y, z);
    }
    if (s2 === 1 || s2 === 3) {
      return p32(x, y, z);
    }
    if (s2 === 2) {
      return maj32(x, y, z);
    }
    return 0;
  }
  function ch32(x, y, z) {
    return x & y ^ ~x & z;
  }
  function maj32(x, y, z) {
    return x & y ^ x & z ^ y & z;
  }
  function p32(x, y, z) {
    return x ^ y ^ z;
  }
  function S0_256(x) {
    return rotr32(x, 2) ^ rotr32(x, 13) ^ rotr32(x, 22);
  }
  function S1_256(x) {
    return rotr32(x, 6) ^ rotr32(x, 11) ^ rotr32(x, 25);
  }
  function G0_256(x) {
    return rotr32(x, 7) ^ rotr32(x, 18) ^ x >>> 3;
  }
  function G1_256(x) {
    return rotr32(x, 17) ^ rotr32(x, 19) ^ x >>> 10;
  }
  var r = [
    0,
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    10,
    11,
    12,
    13,
    14,
    15,
    7,
    4,
    13,
    1,
    10,
    6,
    15,
    3,
    12,
    0,
    9,
    5,
    2,
    14,
    11,
    8,
    3,
    10,
    14,
    4,
    9,
    15,
    8,
    1,
    2,
    7,
    0,
    6,
    13,
    11,
    5,
    12,
    1,
    9,
    11,
    10,
    0,
    8,
    12,
    4,
    13,
    3,
    7,
    15,
    14,
    5,
    6,
    2,
    4,
    0,
    5,
    9,
    7,
    12,
    2,
    10,
    14,
    1,
    3,
    8,
    11,
    6,
    15,
    13
  ];
  var rh = [
    5,
    14,
    7,
    0,
    9,
    2,
    11,
    4,
    13,
    6,
    15,
    8,
    1,
    10,
    3,
    12,
    6,
    11,
    3,
    7,
    0,
    13,
    5,
    10,
    14,
    15,
    8,
    12,
    4,
    9,
    1,
    2,
    15,
    5,
    1,
    3,
    7,
    14,
    6,
    9,
    11,
    8,
    12,
    2,
    10,
    0,
    4,
    13,
    8,
    6,
    4,
    1,
    3,
    11,
    15,
    0,
    5,
    12,
    2,
    13,
    9,
    7,
    10,
    14,
    12,
    15,
    10,
    4,
    1,
    5,
    8,
    7,
    6,
    2,
    13,
    14,
    0,
    3,
    9,
    11
  ];
  var s = [
    11,
    14,
    15,
    12,
    5,
    8,
    7,
    9,
    11,
    13,
    14,
    15,
    6,
    7,
    9,
    8,
    7,
    6,
    8,
    13,
    11,
    9,
    7,
    15,
    7,
    12,
    15,
    9,
    11,
    7,
    13,
    12,
    11,
    13,
    6,
    7,
    14,
    9,
    13,
    15,
    14,
    8,
    13,
    6,
    5,
    12,
    7,
    5,
    11,
    12,
    14,
    15,
    14,
    15,
    9,
    8,
    9,
    14,
    5,
    6,
    8,
    6,
    5,
    12,
    9,
    15,
    5,
    11,
    6,
    8,
    13,
    12,
    5,
    12,
    13,
    14,
    11,
    8,
    5,
    6
  ];
  var sh = [
    8,
    9,
    9,
    11,
    13,
    15,
    15,
    5,
    7,
    7,
    8,
    11,
    14,
    14,
    12,
    6,
    9,
    13,
    15,
    7,
    12,
    8,
    9,
    11,
    7,
    7,
    12,
    7,
    6,
    15,
    13,
    11,
    9,
    7,
    15,
    11,
    8,
    6,
    6,
    14,
    12,
    13,
    5,
    14,
    13,
    13,
    7,
    5,
    15,
    5,
    8,
    11,
    14,
    14,
    6,
    14,
    6,
    9,
    12,
    9,
    12,
    5,
    15,
    8,
    8,
    5,
    12,
    9,
    12,
    5,
    14,
    6,
    8,
    13,
    6,
    5,
    15,
    13,
    11,
    11
  ];
  function f(j, x, y, z) {
    if (j <= 15) {
      return x ^ y ^ z;
    } else if (j <= 31) {
      return x & y | ~x & z;
    } else if (j <= 47) {
      return (x | ~y) ^ z;
    } else if (j <= 63) {
      return x & z | y & ~z;
    } else {
      return x ^ (y | ~z);
    }
  }
  function K(j) {
    if (j <= 15) {
      return 0;
    } else if (j <= 31) {
      return 1518500249;
    } else if (j <= 47) {
      return 1859775393;
    } else if (j <= 63) {
      return 2400959708;
    } else {
      return 2840853838;
    }
  }
  function Kh(j) {
    if (j <= 15) {
      return 1352829926;
    } else if (j <= 31) {
      return 1548603684;
    } else if (j <= 47) {
      return 1836072691;
    } else if (j <= 63) {
      return 2053994217;
    } else {
      return 0;
    }
  }
  var RIPEMD160 = class extends BaseHash {
    constructor() {
      super(512, 160, 192, 64);
      __publicField(this, "h");
      this.endian = "little";
      this.h = [1732584193, 4023233417, 2562383102, 271733878, 3285377520];
      this.endian = "little";
    }
    _update(msg, start) {
      let A2 = this.h[0];
      let B2 = this.h[1];
      let C = this.h[2];
      let D = this.h[3];
      let E = this.h[4];
      let Ah = A2;
      let Bh = B2;
      let Ch = C;
      let Dh = D;
      let Eh = E;
      let T;
      for (let j = 0; j < 80; j++) {
        T = sum32(rotl32(SUM32_4(A2, f(j, B2, C, D), msg[r[j] + start], K(j)), s[j]), E);
        A2 = E;
        E = D;
        D = rotl32(C, 10);
        C = B2;
        B2 = T;
        T = sum32(rotl32(SUM32_4(Ah, f(79 - j, Bh, Ch, Dh), msg[rh[j] + start], Kh(j)), sh[j]), Eh);
        Ah = Eh;
        Eh = Dh;
        Dh = rotl32(Ch, 10);
        Ch = Bh;
        Bh = T;
      }
      T = SUM32_3(this.h[1], C, Dh);
      this.h[1] = SUM32_3(this.h[2], D, Eh);
      this.h[2] = SUM32_3(this.h[3], E, Ah);
      this.h[3] = SUM32_3(this.h[4], A2, Bh);
      this.h[4] = SUM32_3(this.h[0], B2, Ch);
      this.h[0] = T;
    }
    _digest() {
      return split32(this.h, "little");
    }
    _digestHex() {
      return toHex32(this.h, "little");
    }
  };
  var SHA256 = class {
    constructor() {
      __publicField(this, "h");
      __publicField(this, "native");
      this.native = createNodeHash("sha256");
      if (this.native == null) {
        this.h = new FastSHA256();
      }
    }
    update(msg, enc) {
      updateNativeOrFallback(this.native, this.h, toHashBytes(msg, enc));
      return this;
    }
    digest() {
      return digestNativeOrFallback(this.native, this.h);
    }
    digestHex() {
      return digestHexNativeOrFallback(this.native, this.h);
    }
  };
  var SHA1 = class extends BaseHash {
    constructor() {
      super(512, 160, 80, 64);
      __publicField(this, "h");
      __publicField(this, "W");
      __publicField(this, "k");
      this.k = [1518500249, 1859775393, 2400959708, 3395469782];
      this.h = [1732584193, 4023233417, 2562383102, 271733878, 3285377520];
      this.W = new Array(80);
    }
    _update(msg, start) {
      const W = this.W;
      if (start === void 0) {
        start = 0;
      }
      let i;
      for (i = 0; i < 16; i++) {
        W[i] = msg[start + i];
      }
      for (; i < W.length; i++) {
        W[i] = rotl32(W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16], 1);
      }
      let a = this.h[0];
      let b = this.h[1];
      let c = this.h[2];
      let d = this.h[3];
      let e = this.h[4];
      for (i = 0; i < W.length; i++) {
        const s2 = Math.trunc(i / 20);
        const t = SUM32_5(rotl32(a, 5), FT_1(s2, b, c, d), e, W[i], this.k[s2]);
        e = d;
        d = c;
        c = rotl32(b, 30);
        b = a;
        a = t;
      }
      this.h[0] = sum32(this.h[0], a);
      this.h[1] = sum32(this.h[1], b);
      this.h[2] = sum32(this.h[2], c);
      this.h[3] = sum32(this.h[3], d);
      this.h[4] = sum32(this.h[4], e);
    }
    _digest() {
      return split32(this.h, "big");
    }
    _digestHex() {
      return toHex32(this.h, "big");
    }
  };
  var SHA512 = class {
    constructor() {
      __publicField(this, "h");
      __publicField(this, "native");
      this.native = createNodeHash("sha512");
      if (this.native == null) {
        this.h = new FastSHA512();
      }
    }
    update(msg, enc) {
      updateNativeOrFallback(this.native, this.h, toHashBytes(msg, enc));
      return this;
    }
    digest() {
      return digestNativeOrFallback(this.native, this.h);
    }
    digestHex() {
      return digestHexNativeOrFallback(this.native, this.h);
    }
  };
  var SHA256HMAC = class {
    /**
     * The constructor for the `SHA256HMAC` class.
     *
     * It initializes the `SHA256HMAC` object and sets up the inner and outer padded keys.
     * If the key size is larger than the blockSize, it is digested using SHA-256.
     * If the key size is less than the blockSize, it is padded with zeroes.
     *
     * @constructor
     * @param key - The key to use to create the HMAC. Can be a number array or a string in hexadecimal format.
     *
     * @example
     * const myHMAC = new SHA256HMAC('deadbeef');
     */
    constructor(key2) {
      __publicField(this, "h");
      __publicField(this, "native");
      __publicField(this, "blockSize", 64);
      __publicField(this, "outSize", 32);
      const k = toHashKeyBytes(key2);
      this.native = createNodeHmac("sha256", k);
      if (this.native == null) {
        this.h = new HMAC(sha256Fast, k);
      }
    }
    /**
     * Updates the `SHA256HMAC` object with part of the message to be hashed.
     *
     * @method update
     * @param msg - Part of the message to hash. Can be a number array or a string.
     * @param enc - If 'hex', then the input is encoded as hexadecimal. If undefined or not 'hex', then no encoding is performed.
     * @returns Returns the instance of `SHA256HMAC` for chaining calls.
     *
     * @example
     * myHMAC.update('deadbeef', 'hex');
     */
    update(msg, enc) {
      updateNativeOrFallback(this.native, this.h, toHashBytes(msg, enc));
      return this;
    }
    /**
     * Finalizes the HMAC computation and returns the resultant hash.
     *
     * @method digest
     * @returns Returns the digest of the hashed data. Can be a number array or a string.
     *
     * @example
     * let hashedMessage = myHMAC.digest();
     */
    digest() {
      return digestNativeOrFallback(this.native, this.h);
    }
    /**
     * Finalizes the HMAC computation and returns the resultant hash as a hex string.
     *
     * @method digest
     * @returns Returns the digest of the hashed data as a hex string
     *
     * @example
     * let hashedMessage = myHMAC.digestHex();
     */
    digestHex() {
      return digestHexNativeOrFallback(this.native, this.h);
    }
  };
  var SHA1HMAC = class {
    constructor(key2) {
      __publicField(this, "inner");
      __publicField(this, "outer");
      __publicField(this, "blockSize", 64);
      key2 = toArray(key2, "hex");
      if (key2.length > this.blockSize) {
        key2 = new SHA1().update(key2).digest();
      }
      let i;
      for (i = key2.length; i < this.blockSize; i++) {
        key2.push(0);
      }
      for (i = 0; i < key2.length; i++) {
        key2[i] ^= 54;
      }
      this.inner = new SHA1().update(key2);
      for (i = 0; i < key2.length; i++) {
        key2[i] ^= 106;
      }
      this.outer = new SHA1().update(key2);
    }
    update(msg, enc) {
      this.inner.update(msg, enc);
      return this;
    }
    digest() {
      this.outer.update(this.inner.digest());
      return this.outer.digest();
    }
    digestHex() {
      this.outer.update(this.inner.digest());
      return this.outer.digestHex();
    }
  };
  var SHA512HMAC = class {
    /**
     * The constructor for the `SHA512HMAC` class.
     *
     * It initializes the `SHA512HMAC` object and sets up the inner and outer padded keys.
     * If the key size is larger than the blockSize, it is digested using SHA-512.
     * If the key size is less than the blockSize, it is padded with zeroes.
     *
     * @constructor
     * @param key - The key to use to create the HMAC. Can be a number array or a string in hexadecimal format.
     *
     * @example
     * const myHMAC = new SHA512HMAC('deadbeef');
     */
    constructor(key2) {
      __publicField(this, "h");
      __publicField(this, "native");
      __publicField(this, "blockSize", 128);
      __publicField(this, "outSize", 32);
      const k = toHashKeyBytes(key2);
      this.native = createNodeHmac("sha512", k);
      if (this.native == null) {
        this.h = new HMAC(sha512Fast, k);
      }
    }
    /**
     * Updates the `SHA512HMAC` object with part of the message to be hashed.
     *
     * @method update
     * @param msg - Part of the message to hash. Can be a number array or a string.
     * @param enc - If 'hex', then the input is encoded as hexadecimal. If undefined or not 'hex', then no encoding is performed.
     * @returns Returns the instance of `SHA512HMAC` for chaining calls.
     *
     * @example
     * myHMAC.update('deadbeef', 'hex');
     */
    update(msg, enc) {
      updateNativeOrFallback(this.native, this.h, toHashBytes(msg, enc));
      return this;
    }
    /**
     * Finalizes the HMAC computation and returns the resultant hash.
     *
     * @method digest
     * @returns Returns the digest of the hashed data as a number array.
     *
     * @example
     * let hashedMessage = myHMAC.digest();
     */
    digest() {
      return digestNativeOrFallback(this.native, this.h);
    }
    /**
     * Finalizes the HMAC computation and returns the resultant hash as a hex string.
     *
     * @method digest
     * @returns Returns the digest of the hashed data as a hex string
     *
     * @example
     * let hashedMessage = myHMAC.digestHex();
     */
    digestHex() {
      return digestHexNativeOrFallback(this.native, this.h);
    }
  };
  function sha256Bytes(msg, enc) {
    const native = digestWithNodeHash("sha256", msg, enc);
    if (native != null)
      return native;
    return new FastSHA256().update(toHashBytes(msg, enc)).digest();
  }
  function sha512Bytes(msg, enc) {
    const native = digestWithNodeHash("sha512", msg, enc);
    if (native != null)
      return native;
    return new FastSHA512().update(toHashBytes(msg, enc)).digest();
  }
  function ripemd160Bytes(msg, enc) {
    return digestWithNodeHash("ripemd160", msg, enc);
  }
  var ripemd160 = (msg, enc) => {
    const native = ripemd160Bytes(msg, enc);
    if (native != null)
      return Array.from(native);
    return new RIPEMD160().update(msg, enc).digest();
  };
  var sha1 = (msg, enc) => {
    return new SHA1().update(msg, enc).digest();
  };
  var sha256 = (msg, enc) => {
    return Array.from(sha256Bytes(msg, enc));
  };
  var sha512 = (msg, enc) => {
    return Array.from(sha512Bytes(msg, enc));
  };
  var hash256 = (msg, enc) => {
    return Array.from(sha256Bytes(sha256Bytes(msg, enc)));
  };
  var hash160 = (msg, enc) => {
    const first = sha256Bytes(msg, enc);
    const native = ripemd160Bytes(first);
    if (native != null)
      return Array.from(native);
    return new RIPEMD160().update(first).digest();
  };
  var sha256hmac = (key2, msg, enc) => {
    const native = digestWithNodeHmac("sha256", key2, msg, enc);
    if (native != null)
      return Array.from(native);
    return new SHA256HMAC(key2).update(msg, enc).digest();
  };
  var sha512hmac = (key2, msg, enc) => {
    const native = digestWithNodeHmac("sha512", key2, msg, enc);
    if (native != null)
      return Array.from(native);
    return new SHA512HMAC(key2).update(msg, enc).digest();
  };
  function isBytes(a) {
    return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
  }
  function anumber(n) {
    if (!Number.isSafeInteger(n) || n < 0) {
      throw new Error(`positive integer expected, got ${n}`);
    }
  }
  function abytes(b, ...lengths) {
    if (!isBytes(b))
      throw new Error("Uint8Array expected");
    if (lengths.length > 0 && !lengths.includes(b.length)) {
      const lens = lengths.join(",");
      throw new Error(`Uint8Array expected of length ${lens}, got length=${b.length}`);
    }
  }
  function ahash(h) {
    if (typeof h !== "function" || typeof h.create !== "function") {
      throw new TypeError("Hash should be wrapped by utils.createHasher");
    }
    anumber(h.outputLen);
    anumber(h.blockLen);
  }
  function aexists(instance, checkFinished = true) {
    if (instance.destroyed === true)
      throw new Error("Hash instance has been destroyed");
    if (checkFinished && instance.finished === true) {
      throw new Error("Hash#digest() has already been called");
    }
  }
  function aoutput(out, instance) {
    abytes(out);
    const min = instance.outputLen;
    if (out.length < min) {
      throw new Error(`digestInto() expects output buffer of length at least ${min}`);
    }
  }
  function clean(...arrays) {
    for (const arr of arrays)
      arr.fill(0);
  }
  function createView(arr) {
    return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
  }
  function toBytes(data) {
    if (typeof data === "string")
      data = utf8ToBytes(data);
    abytes(data);
    return data;
  }
  function utf8ToBytes(str) {
    if (typeof str !== "string")
      throw new Error("string expected");
    return new Uint8Array(new TextEncoder().encode(str));
  }
  function kdfInputToBytes(data) {
    if (typeof data === "string")
      data = utf8ToBytes(data);
    abytes(data);
    return data;
  }
  var Hash = class {
  };
  function createHasher(hashCons) {
    const hashC = (msg) => hashCons().update(toBytes(msg)).digest();
    const tmp = hashCons();
    hashC.outputLen = tmp.outputLen;
    hashC.blockLen = tmp.blockLen;
    hashC.create = () => hashCons();
    return hashC;
  }
  var U32_MASK64 = BigInt(2 ** 32 - 1);
  var _32n = BigInt(32);
  function fromBig(n, le = false) {
    if (le)
      return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
    return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
  }
  function split(lst, le = false) {
    const len = lst.length;
    const Ah = new Uint32Array(len);
    const Al = new Uint32Array(len);
    for (let i = 0; i < len; i++) {
      const { h, l } = fromBig(lst[i], le);
      Ah[i] = h;
      Al[i] = l;
    }
    return [Ah, Al];
  }
  var shrSH = (h, _l, s2) => h >>> s2;
  var shrSL = (h, l, s2) => h << 32 - s2 | l >>> s2;
  var rotrSH = (h, l, s2) => h >>> s2 | l << 32 - s2;
  var rotrSL = (h, l, s2) => h << 32 - s2 | l >>> s2;
  var rotrBH = (h, l, s2) => h << 64 - s2 | l >>> s2 - 32;
  var rotrBL = (h, l, s2) => h >>> s2 - 32 | l << 64 - s2;
  function add(Ah, Al, Bh, Bl) {
    const l = (Al >>> 0) + (Bl >>> 0);
    return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
  }
  var add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
  var add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;
  var add4L = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0);
  var add4H = (low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0;
  var add5L = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
  var add5H = (low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0;
  var HashMD = class extends Hash {
    constructor(blockLen, outputLen, padOffset, isLE) {
      super();
      __publicField(this, "blockLen");
      __publicField(this, "outputLen");
      __publicField(this, "padOffset");
      __publicField(this, "isLE");
      __publicField(this, "buffer");
      __publicField(this, "view");
      __publicField(this, "finished", false);
      __publicField(this, "length", 0);
      __publicField(this, "pos", 0);
      __publicField(this, "destroyed", false);
      this.blockLen = blockLen;
      this.outputLen = outputLen;
      this.padOffset = padOffset;
      this.isLE = isLE;
      this.buffer = new Uint8Array(blockLen);
      this.view = createView(this.buffer);
    }
    update(data) {
      aexists(this);
      data = toBytes(data);
      abytes(data);
      const { view, buffer, blockLen } = this;
      const len = data.length;
      for (let pos = 0; pos < len; ) {
        const take = Math.min(blockLen - this.pos, len - pos);
        if (take === blockLen) {
          const dataView = createView(data);
          for (; blockLen <= len - pos; pos += blockLen)
            this.process(dataView, pos);
          continue;
        }
        buffer.set(data.subarray(pos, pos + take), this.pos);
        this.pos += take;
        pos += take;
        if (this.pos === blockLen) {
          this.process(view, 0);
          this.pos = 0;
        }
      }
      this.length += data.length;
      this.roundClean();
      return this;
    }
    digestInto(out) {
      aexists(this);
      aoutput(out, this);
      this.finished = true;
      const { buffer, view, blockLen, isLE } = this;
      let { pos } = this;
      buffer[pos++] = 128;
      clean(this.buffer.subarray(pos));
      if (this.padOffset > blockLen - pos) {
        this.process(view, 0);
        pos = 0;
      }
      for (let i = pos; i < blockLen; i++)
        buffer[i] = 0;
      setBigUint64(view, blockLen - 8, BigInt(this.length * 8), isLE);
      this.process(view, 0);
      const oview = createView(out);
      const len = this.outputLen;
      if (len % 4 !== 0)
        throw new Error("_sha2: outputLen should be aligned to 32bit");
      const outLen = len / 4;
      const state = this.get();
      if (outLen > state.length)
        throw new Error("_sha2: outputLen bigger than state");
      for (let i = 0; i < outLen; i++)
        oview.setUint32(4 * i, state[i], isLE);
    }
    digest() {
      const { buffer, outputLen } = this;
      this.digestInto(buffer);
      const res = buffer.slice(0, outputLen);
      this.destroy();
      return res;
    }
    _cloneInto(to) {
      to || (to = new this.constructor());
      to.set(...this.get());
      const { blockLen, buffer, length, finished, destroyed, pos } = this;
      to.destroyed = destroyed;
      to.finished = finished;
      to.length = length;
      to.pos = pos;
      if (length % blockLen !== 0)
        to.buffer.set(buffer);
      return to;
    }
    clone() {
      return this._cloneInto();
    }
  };
  function setBigUint64(view, byteOffset, value, isLE) {
    if (typeof view.setBigUint64 === "function")
      return view.setBigUint64(byteOffset, value, isLE);
    const _32n2 = BigInt(32);
    const _u32_max = BigInt(4294967295);
    const wh = Number(value >> _32n2 & _u32_max);
    const wl = Number(value & _u32_max);
    const h = isLE ? 4 : 0;
    const l = isLE ? 0 : 4;
    view.setUint32(byteOffset + h, wh, isLE);
    view.setUint32(byteOffset + l, wl, isLE);
  }
  var SHA256_IV = Uint32Array.from([
    1779033703,
    3144134277,
    1013904242,
    2773480762,
    1359893119,
    2600822924,
    528734635,
    1541459225
  ]);
  var K2562 = Uint32Array.from([
    1116352408,
    1899447441,
    3049323471,
    3921009573,
    961987163,
    1508970993,
    2453635748,
    2870763221,
    3624381080,
    310598401,
    607225278,
    1426881987,
    1925078388,
    2162078206,
    2614888103,
    3248222580,
    3835390401,
    4022224774,
    264347078,
    604807628,
    770255983,
    1249150122,
    1555081692,
    1996064986,
    2554220882,
    2821834349,
    2952996808,
    3210313671,
    3336571891,
    3584528711,
    113926993,
    338241895,
    666307205,
    773529912,
    1294757372,
    1396182291,
    1695183700,
    1986661051,
    2177026350,
    2456956037,
    2730485921,
    2820302411,
    3259730800,
    3345764771,
    3516065817,
    3600352804,
    4094571909,
    275423344,
    430227734,
    506948616,
    659060556,
    883997877,
    958139571,
    1322822218,
    1537002063,
    1747873779,
    1955562222,
    2024104815,
    2227730452,
    2361852424,
    2428436474,
    2756734187,
    3204031479,
    3329325298
  ]);
  var SHA256_W = new Uint32Array(64);
  var FastSHA256 = class extends HashMD {
    constructor(outputLen = 32) {
      super(64, outputLen, 8, false);
      // eslint-disable-next-line no-bitwise -- ToInt32 (ECMA-262); not truncation. Required for SHA arithmetic.
      __publicField(this, "A", SHA256_IV[0] | 0);
      // eslint-disable-next-line no-bitwise -- ToInt32 (ECMA-262); not truncation. Required for SHA arithmetic.
      __publicField(this, "B", SHA256_IV[1] | 0);
      // eslint-disable-next-line no-bitwise -- ToInt32 (ECMA-262); not truncation. Required for SHA arithmetic.
      __publicField(this, "C", SHA256_IV[2] | 0);
      // eslint-disable-next-line no-bitwise -- ToInt32 (ECMA-262); not truncation. Required for SHA arithmetic.
      __publicField(this, "D", SHA256_IV[3] | 0);
      // eslint-disable-next-line no-bitwise -- ToInt32 (ECMA-262); not truncation. Required for SHA arithmetic.
      __publicField(this, "E", SHA256_IV[4] | 0);
      // eslint-disable-next-line no-bitwise -- ToInt32 (ECMA-262); not truncation. Required for SHA arithmetic.
      __publicField(this, "F", SHA256_IV[5] | 0);
      // eslint-disable-next-line no-bitwise -- ToInt32 (ECMA-262); not truncation. Required for SHA arithmetic.
      __publicField(this, "G", SHA256_IV[6] | 0);
      // eslint-disable-next-line no-bitwise -- ToInt32 (ECMA-262); not truncation. Required for SHA arithmetic.
      __publicField(this, "H", SHA256_IV[7] | 0);
    }
    get() {
      const { A: A2, B: B2, C, D, E, F, G, H } = this;
      return [A2, B2, C, D, E, F, G, H];
    }
    set(A2, B2, C, D, E, F, G, H) {
      this.A = A2 | 0;
      this.B = B2 | 0;
      this.C = C | 0;
      this.D = D | 0;
      this.E = E | 0;
      this.F = F | 0;
      this.G = G | 0;
      this.H = H | 0;
    }
    process(view, offset) {
      for (let i = 0; i < 16; i++, offset += 4) {
        SHA256_W[i] = view.getUint32(offset);
      }
      for (let i = 16; i < 64; i++) {
        const w15 = SHA256_W[i - 15];
        const w2 = SHA256_W[i - 2];
        const s0 = G0_256(w15);
        const s1 = G1_256(w2);
        SHA256_W[i] = sum32(sum32(s0, SHA256_W[i - 7]), sum32(s1, SHA256_W[i - 16]));
      }
      let { A: A2, B: B2, C, D, E, F, G, H } = this;
      for (let i = 0; i < 64; i++) {
        const T1 = SUM32_5(H, S1_256(E), ch32(E, F, G), K2562[i], SHA256_W[i]);
        const T2 = sum32(S0_256(A2), maj32(A2, B2, C));
        H = G;
        G = F;
        F = E;
        E = sum32(D, T1);
        D = C;
        C = B2;
        B2 = A2;
        A2 = sum32(T1, T2);
      }
      this.A = sum32(this.A, A2);
      this.B = sum32(this.B, B2);
      this.C = sum32(this.C, C);
      this.D = sum32(this.D, D);
      this.E = sum32(this.E, E);
      this.F = sum32(this.F, F);
      this.G = sum32(this.G, G);
      this.H = sum32(this.H, H);
    }
    roundClean() {
      clean(SHA256_W);
    }
    destroy() {
      clean(this.buffer);
      this.set(0, 0, 0, 0, 0, 0, 0, 0);
    }
  };
  var sha256Fast = createHasher(() => new FastSHA256());
  var SHA512_IV = Uint32Array.from([
    1779033703,
    4089235720,
    3144134277,
    2227873595,
    1013904242,
    4271175723,
    2773480762,
    1595750129,
    1359893119,
    2917565137,
    2600822924,
    725511199,
    528734635,
    4215389547,
    1541459225,
    327033209
  ]);
  var K512 = (() => split([
    "0x428a2f98d728ae22",
    "0x7137449123ef65cd",
    "0xb5c0fbcfec4d3b2f",
    "0xe9b5dba58189dbbc",
    "0x3956c25bf348b538",
    "0x59f111f1b605d019",
    "0x923f82a4af194f9b",
    "0xab1c5ed5da6d8118",
    "0xd807aa98a3030242",
    "0x12835b0145706fbe",
    "0x243185be4ee4b28c",
    "0x550c7dc3d5ffb4e2",
    "0x72be5d74f27b896f",
    "0x80deb1fe3b1696b1",
    "0x9bdc06a725c71235",
    "0xc19bf174cf692694",
    "0xe49b69c19ef14ad2",
    "0xefbe4786384f25e3",
    "0x0fc19dc68b8cd5b5",
    "0x240ca1cc77ac9c65",
    "0x2de92c6f592b0275",
    "0x4a7484aa6ea6e483",
    "0x5cb0a9dcbd41fbd4",
    "0x76f988da831153b5",
    "0x983e5152ee66dfab",
    "0xa831c66d2db43210",
    "0xb00327c898fb213f",
    "0xbf597fc7beef0ee4",
    "0xc6e00bf33da88fc2",
    "0xd5a79147930aa725",
    "0x06ca6351e003826f",
    "0x142929670a0e6e70",
    "0x27b70a8546d22ffc",
    "0x2e1b21385c26c926",
    "0x4d2c6dfc5ac42aed",
    "0x53380d139d95b3df",
    "0x650a73548baf63de",
    "0x766a0abb3c77b2a8",
    "0x81c2c92e47edaee6",
    "0x92722c851482353b",
    "0xa2bfe8a14cf10364",
    "0xa81a664bbc423001",
    "0xc24b8b70d0f89791",
    "0xc76c51a30654be30",
    "0xd192e819d6ef5218",
    "0xd69906245565a910",
    "0xf40e35855771202a",
    "0x106aa07032bbd1b8",
    "0x19a4c116b8d2d0c8",
    "0x1e376c085141ab53",
    "0x2748774cdf8eeb99",
    "0x34b0bcb5e19b48a8",
    "0x391c0cb3c5c95a63",
    "0x4ed8aa4ae3418acb",
    "0x5b9cca4f7763e373",
    "0x682e6ff3d6b2b8a3",
    "0x748f82ee5defb2fc",
    "0x78a5636f43172f60",
    "0x84c87814a1f0ab72",
    "0x8cc702081a6439ec",
    "0x90befffa23631e28",
    "0xa4506cebde82bde9",
    "0xbef9a3f7b2c67915",
    "0xc67178f2e372532b",
    "0xca273eceea26619c",
    "0xd186b8c721c0c207",
    "0xeada7dd6cde0eb1e",
    "0xf57d4f7fee6ed178",
    "0x06f067aa72176fba",
    "0x0a637dc5a2c898a6",
    "0x113f9804bef90dae",
    "0x1b710b35131c471b",
    "0x28db77f523047d84",
    "0x32caab7b40c72493",
    "0x3c9ebe0a15c9bebc",
    "0x431d67c49c100d4c",
    "0x4cc5d4becb3e42b6",
    "0x597f299cfc657e2a",
    "0x5fcb6fab3ad6faec",
    "0x6c44198c4a475817"
  ].map(BigInt)))();
  var SHA512_Kh = (() => K512[0])();
  var SHA512_Kl = (() => K512[1])();
  var SHA512_W_H = new Uint32Array(80);
  var SHA512_W_L = new Uint32Array(80);
  var FastSHA512 = class extends HashMD {
    constructor(outputLen = 64) {
      super(128, outputLen, 16, false);
      // eslint-disable-next-line no-bitwise -- ToInt32 (ECMA-262); not truncation. Required for SHA arithmetic.
      __publicField(this, "Ah", SHA512_IV[0] | 0);
      // eslint-disable-next-line no-bitwise -- ToInt32 (ECMA-262); not truncation. Required for SHA arithmetic.
      __publicField(this, "Al", SHA512_IV[1] | 0);
      // eslint-disable-next-line no-bitwise -- ToInt32 (ECMA-262); not truncation. Required for SHA arithmetic.
      __publicField(this, "Bh", SHA512_IV[2] | 0);
      // eslint-disable-next-line no-bitwise -- ToInt32 (ECMA-262); not truncation. Required for SHA arithmetic.
      __publicField(this, "Bl", SHA512_IV[3] | 0);
      // eslint-disable-next-line no-bitwise -- ToInt32 (ECMA-262); not truncation. Required for SHA arithmetic.
      __publicField(this, "Ch", SHA512_IV[4] | 0);
      // eslint-disable-next-line no-bitwise -- ToInt32 (ECMA-262); not truncation. Required for SHA arithmetic.
      __publicField(this, "Cl", SHA512_IV[5] | 0);
      // eslint-disable-next-line no-bitwise -- ToInt32 (ECMA-262); not truncation. Required for SHA arithmetic.
      __publicField(this, "Dh", SHA512_IV[6] | 0);
      // eslint-disable-next-line no-bitwise -- ToInt32 (ECMA-262); not truncation. Required for SHA arithmetic.
      __publicField(this, "Dl", SHA512_IV[7] | 0);
      // eslint-disable-next-line no-bitwise -- ToInt32 (ECMA-262); not truncation. Required for SHA arithmetic.
      __publicField(this, "Eh", SHA512_IV[8] | 0);
      // eslint-disable-next-line no-bitwise -- ToInt32 (ECMA-262); not truncation. Required for SHA arithmetic.
      __publicField(this, "El", SHA512_IV[9] | 0);
      // eslint-disable-next-line no-bitwise -- ToInt32 (ECMA-262); not truncation. Required for SHA arithmetic.
      __publicField(this, "Fh", SHA512_IV[10] | 0);
      // eslint-disable-next-line no-bitwise -- ToInt32 (ECMA-262); not truncation. Required for SHA arithmetic.
      __publicField(this, "Fl", SHA512_IV[11] | 0);
      // eslint-disable-next-line no-bitwise -- ToInt32 (ECMA-262); not truncation. Required for SHA arithmetic.
      __publicField(this, "Gh", SHA512_IV[12] | 0);
      // eslint-disable-next-line no-bitwise -- ToInt32 (ECMA-262); not truncation. Required for SHA arithmetic.
      __publicField(this, "Gl", SHA512_IV[13] | 0);
      // eslint-disable-next-line no-bitwise -- ToInt32 (ECMA-262); not truncation. Required for SHA arithmetic.
      __publicField(this, "Hh", SHA512_IV[14] | 0);
      // eslint-disable-next-line no-bitwise -- ToInt32 (ECMA-262); not truncation. Required for SHA arithmetic.
      __publicField(this, "Hl", SHA512_IV[15] | 0);
    }
    get() {
      const { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
      return [Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl];
    }
    set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
      this.Ah = Ah | 0;
      this.Al = Al | 0;
      this.Bh = Bh | 0;
      this.Bl = Bl | 0;
      this.Ch = Ch | 0;
      this.Cl = Cl | 0;
      this.Dh = Dh | 0;
      this.Dl = Dl | 0;
      this.Eh = Eh | 0;
      this.El = El | 0;
      this.Fh = Fh | 0;
      this.Fl = Fl | 0;
      this.Gh = Gh | 0;
      this.Gl = Gl | 0;
      this.Hh = Hh | 0;
      this.Hl = Hl | 0;
    }
    process(view, offset) {
      for (let i = 0; i < 16; i++, offset += 8) {
        SHA512_W_H[i] = view.getUint32(offset);
        SHA512_W_L[i] = view.getUint32(offset + 4);
      }
      for (let i = 16; i < 80; i++) {
        const W15h = SHA512_W_H[i - 15] | 0;
        const W15l = SHA512_W_L[i - 15] | 0;
        const s0h = rotrSH(W15h, W15l, 1) ^ rotrSH(W15h, W15l, 8) ^ shrSH(W15h, W15l, 7);
        const s0l = rotrSL(W15h, W15l, 1) ^ rotrSL(W15h, W15l, 8) ^ shrSL(W15h, W15l, 7);
        const W2h = SHA512_W_H[i - 2] | 0;
        const W2l = SHA512_W_L[i - 2] | 0;
        const s1h = rotrSH(W2h, W2l, 19) ^ rotrBH(W2h, W2l, 61) ^ shrSH(W2h, W2l, 6);
        const s1l = rotrSL(W2h, W2l, 19) ^ rotrBL(W2h, W2l, 61) ^ shrSL(W2h, W2l, 6);
        const SUMl = add4L(s0l, s1l, SHA512_W_L[i - 7], SHA512_W_L[i - 16]);
        const SUMh = add4H(SUMl, s0h, s1h, SHA512_W_H[i - 7], SHA512_W_H[i - 16]);
        SHA512_W_H[i] = SUMh | 0;
        SHA512_W_L[i] = SUMl | 0;
      }
      let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
      for (let i = 0; i < 80; i++) {
        const sigma1h = rotrSH(Eh, El, 14) ^ rotrSH(Eh, El, 18) ^ rotrBH(Eh, El, 41);
        const sigma1l = rotrSL(Eh, El, 14) ^ rotrSL(Eh, El, 18) ^ rotrBL(Eh, El, 41);
        const CHIh = Eh & Fh ^ ~Eh & Gh;
        const CHIl = El & Fl ^ ~El & Gl;
        const T1ll = add5L(Hl, sigma1l, CHIl, SHA512_Kl[i], SHA512_W_L[i]);
        const T1h = add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i], SHA512_W_H[i]);
        const T1l = T1ll | 0;
        const sigma0h = rotrSH(Ah, Al, 28) ^ rotrBH(Ah, Al, 34) ^ rotrBH(Ah, Al, 39);
        const sigma0l = rotrSL(Ah, Al, 28) ^ rotrBL(Ah, Al, 34) ^ rotrBL(Ah, Al, 39);
        const MAJh = Ah & Bh ^ Ah & Ch ^ Bh & Ch;
        const MAJl = Al & Bl ^ Al & Cl ^ Bl & Cl;
        Hh = Gh | 0;
        Hl = Gl | 0;
        Gh = Fh | 0;
        Gl = Fl | 0;
        Fh = Eh | 0;
        Fl = El | 0;
        ({ h: Eh, l: El } = add(Dh | 0, Dl | 0, T1h | 0, T1l | 0));
        Dh = Ch | 0;
        Dl = Cl | 0;
        Ch = Bh | 0;
        Cl = Bl | 0;
        Bh = Ah | 0;
        Bl = Al | 0;
        const T2l = add3L(sigma0l, MAJl, T1l);
        Ah = add3H(T2l, sigma0h, MAJh, T1h);
        Al = T2l | 0;
      }
      ;
      ({ h: Ah, l: Al } = add(Ah, Al, this.Ah, this.Al));
      ({ h: Bh, l: Bl } = add(Bh, Bl, this.Bh, this.Bl));
      ({ h: Ch, l: Cl } = add(Ch, Cl, this.Ch, this.Cl));
      ({ h: Dh, l: Dl } = add(Dh, Dl, this.Dh, this.Dl));
      ({ h: Eh, l: El } = add(Eh, El, this.Eh, this.El));
      ({ h: Fh, l: Fl } = add(Fh, Fl, this.Fh, this.Fl));
      ({ h: Gh, l: Gl } = add(Gh, Gl, this.Gh, this.Gl));
      ({ h: Hh, l: Hl } = add(Hh, Hl, this.Hh, this.Hl));
      this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
    }
    roundClean() {
      clean(SHA512_W_H, SHA512_W_L);
    }
    destroy() {
      clean(this.buffer);
      this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    }
  };
  var sha512Fast = createHasher(() => new FastSHA512());
  var HMAC = class extends Hash {
    constructor(hash, _key) {
      super();
      __publicField(this, "oHash");
      __publicField(this, "iHash");
      __publicField(this, "blockLen");
      __publicField(this, "outputLen");
      __publicField(this, "finished", false);
      __publicField(this, "destroyed", false);
      ahash(hash);
      const key2 = toBytes(_key);
      this.iHash = hash.create();
      if (typeof this.iHash.update !== "function") {
        throw new TypeError("Expected instance of class which extends utils.Hash");
      }
      this.blockLen = this.iHash.blockLen;
      this.outputLen = this.iHash.outputLen;
      const blockLen = this.blockLen;
      const pad = new Uint8Array(blockLen);
      pad.set(key2.length > blockLen ? hash.create().update(key2).digest() : key2);
      for (let i = 0; i < pad.length; i++)
        pad[i] ^= 54;
      this.iHash.update(pad);
      this.oHash = hash.create();
      for (let i = 0; i < pad.length; i++)
        pad[i] ^= 54 ^ 92;
      this.oHash.update(pad);
      clean(pad);
    }
    update(buf) {
      aexists(this);
      this.iHash.update(buf);
      return this;
    }
    digestInto(out) {
      aexists(this);
      abytes(out, this.outputLen);
      this.finished = true;
      this.iHash.digestInto(out);
      this.oHash.update(out);
      this.oHash.digestInto(out);
      this.destroy();
    }
    digest() {
      const out = new Uint8Array(this.oHash.outputLen);
      this.digestInto(out);
      return out;
    }
    _cloneInto(to) {
      to || (to = Object.create(Object.getPrototypeOf(this), {}));
      const { oHash, iHash, finished, destroyed, blockLen, outputLen } = this;
      to = to;
      to.finished = finished;
      to.destroyed = destroyed;
      to.blockLen = blockLen;
      to.outputLen = outputLen;
      to.oHash = oHash._cloneInto(to.oHash ?? void 0);
      to.iHash = iHash._cloneInto(to.iHash ?? void 0);
      return to;
    }
    clone() {
      return this._cloneInto();
    }
    destroy() {
      this.destroyed = true;
      this.oHash.destroy();
      this.iHash.destroy();
    }
  };
  function pbkdf2Core(hash, password, salt, opts) {
    ahash(hash);
    const { c, dkLen } = Object.assign({ dkLen: 32 }, opts);
    anumber(c);
    anumber(dkLen);
    if (c < 1)
      throw new Error("iterations (c) should be >= 1");
    const pwd = kdfInputToBytes(password);
    const slt = kdfInputToBytes(salt);
    const DK = new Uint8Array(dkLen);
    const PRF = hmac.create(hash, pwd);
    const PRFSalt = PRF._cloneInto().update(slt);
    let prfW;
    const arr = new Uint8Array(4);
    const view = createView(arr);
    const u = new Uint8Array(PRF.outputLen);
    for (let ti = 1, pos = 0; pos < dkLen; ti++, pos += PRF.outputLen) {
      const Ti = DK.subarray(pos, pos + PRF.outputLen);
      view.setInt32(0, ti, false);
      prfW = PRFSalt._cloneInto(prfW);
      prfW.update(arr).digestInto(u);
      Ti.set(u.subarray(0, Ti.length));
      for (let ui = 1; ui < c; ui++) {
        PRF._cloneInto(prfW).update(u).digestInto(u);
        for (let i = 0; i < Ti.length; i++)
          Ti[i] ^= u[i];
      }
    }
    PRF.destroy();
    PRFSalt.destroy();
    if (prfW != null)
      prfW.destroy();
    clean(u);
    return DK;
  }
  var hmac = (hash, key2, message) => new HMAC(hash, key2).update(message).digest();
  hmac.create = (hash, key2) => new HMAC(hash, key2);
  function pbkdf2Fast(password, salt, iterations, keylen) {
    return pbkdf2Core(sha512Fast, password, salt, { c: iterations, dkLen: keylen });
  }
  function pbkdf2(password, salt, iterations, keylen, digest = "sha512") {
    if (digest !== "sha512") {
      throw new Error("Only sha512 is supported in this PBKDF2 implementation");
    }
    const pbkdf2Sync = NODE_CRYPTO?.pbkdf2Sync;
    if (typeof pbkdf2Sync === "function") {
      const out2 = pbkdf2Sync(toHashBytes(password), toHashBytes(salt), iterations, keylen, digest);
      return Array.from(out2);
    }
    const p = Uint8Array.from(password);
    const s2 = Uint8Array.from(salt);
    const out = pbkdf2Fast(p, s2, iterations, keylen);
    return Array.from(out);
  }
  function swapBytes32(w) {
    const res = w >>> 24 | w >>> 8 & 65280 | w << 8 & 16711680 | (w & 255) << 24;
    return res >>> 0;
  }
  var isLittleEndian = (() => {
    const b = new ArrayBuffer(4);
    const a = new Uint32Array(b);
    const c = new Uint8Array(b);
    a[0] = 16909060;
    return c[0] === 4;
  })();
  function realHtonl(w) {
    return isLittleEndian ? swapBytes32(w) : w >>> 0;
  }

  // node_modules/@bsv/sdk/dist/esm/src/primitives/WriterUint8Array.js
  var WriterUint8Array = class {
    constructor(bufs, initialCapacity = 256) {
      __publicField(this, "buffer");
      __publicField(this, "pos");
      __publicField(this, "capacity");
      if (bufs != null && bufs.length > 0) {
        const totalLength = bufs.reduce((sum, buf) => sum + buf.length, 0);
        initialCapacity = Math.max(initialCapacity, totalLength);
      }
      this.buffer = new Uint8Array(initialCapacity);
      this.pos = 0;
      this.capacity = initialCapacity;
      if (bufs != null) {
        for (const buf of bufs) {
          this.write(buf);
        }
      }
    }
    /**
     * Returns the current length of written data
     */
    getLength() {
      return this.pos;
    }
    /**
     * @return the written data as Uint8Array copy of the internal buffer
     */
    toUint8Array() {
      return this.buffer.slice(0, this.pos);
    }
    /**
     * Legacy compatibility method – returns number[] (Byte[])
     */
    toArray() {
      return Array.from(this.toUint8Array());
    }
    /**
     * @return the written data as Uint8Array. CAUTION: This is zero-copy subarray of the internal buffer).
     */
    toUint8ArrayZeroCopy() {
      return this.buffer.subarray(0, this.pos);
    }
    ensureCapacity(needed) {
      if (this.pos + needed > this.capacity) {
        let newCapacity = this.capacity * 2;
        while (this.pos + needed > newCapacity) {
          newCapacity *= 2;
        }
        const newBuffer = new Uint8Array(newCapacity);
        newBuffer.set(this.buffer);
        this.buffer = newBuffer;
        this.capacity = newCapacity;
      }
    }
    write(bytes2) {
      const data = bytes2 instanceof Uint8Array ? bytes2 : new Uint8Array(bytes2);
      this.ensureCapacity(data.length);
      this.buffer.set(data, this.pos);
      this.pos += data.length;
      return this;
    }
    writeReverse(buf) {
      const data = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
      this.ensureCapacity(data.length);
      for (let i = data.length - 1; i >= 0; i--) {
        this.buffer[this.pos] = data[i];
        this.pos += 1;
      }
      return this;
    }
    writeUInt8(value) {
      this.ensureCapacity(1);
      this.buffer[this.pos] = value & 255;
      this.pos += 1;
      return this;
    }
    writeInt8(value) {
      this.writeUInt8(value);
      return this;
    }
    writeUInt16LE(value) {
      this.ensureCapacity(2);
      this.buffer[this.pos] = value & 255;
      this.buffer[this.pos + 1] = value >> 8 & 255;
      this.pos += 2;
      return this;
    }
    writeUInt16BE(value) {
      this.ensureCapacity(2);
      this.buffer[this.pos] = value >> 8 & 255;
      this.buffer[this.pos + 1] = value & 255;
      this.pos += 2;
      return this;
    }
    writeInt16LE(value) {
      this.writeUInt16LE(value & 65535);
      return this;
    }
    writeInt16BE(value) {
      this.writeUInt16BE(value & 65535);
      return this;
    }
    writeUInt32LE(value) {
      this.ensureCapacity(4);
      this.buffer[this.pos] = value & 255;
      this.buffer[this.pos + 1] = value >> 8 & 255;
      this.buffer[this.pos + 2] = value >> 16 & 255;
      this.buffer[this.pos + 3] = value >> 24 & 255;
      this.pos += 4;
      return this;
    }
    writeUInt32BE(value) {
      this.ensureCapacity(4);
      this.buffer[this.pos] = value >> 24 & 255;
      this.buffer[this.pos + 1] = value >> 16 & 255;
      this.buffer[this.pos + 2] = value >> 8 & 255;
      this.buffer[this.pos + 3] = value & 255;
      this.pos += 4;
      return this;
    }
    writeInt32LE(value) {
      this.writeUInt32LE(value >>> 0);
      return this;
    }
    writeInt32BE(value) {
      this.writeUInt32BE(value >>> 0);
      return this;
    }
    writeUInt64BEBn(bn) {
      const buf = bn.toArray("be", 8);
      this.write(buf);
      return this;
    }
    writeUInt64LEBn(bn) {
      const buf = bn.toArray("be", 8);
      this.writeReverse(buf);
      return this;
    }
    writeUInt64LE(n) {
      const buf = new BigNumber(n).toArray("be", 8);
      this.writeReverse(buf);
      return this;
    }
    writeVarIntNum(n) {
      const buf = Writer.varIntNum(n);
      this.write(buf);
      return this;
    }
    writeVarIntBn(bn) {
      const buf = Writer.varIntBn(bn);
      this.write(buf);
      return this;
    }
    /**
     * Resets the writer to empty state (reuses the buffer)
     */
    reset() {
      this.pos = 0;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/ReaderUint8Array.js
  var ReaderUint8Array = class _ReaderUint8Array {
    constructor(bin = new Uint8Array(0), pos = 0) {
      __publicField(this, "bin");
      __publicField(this, "pos");
      __publicField(this, "length");
      if (bin instanceof Uint8Array) {
        this.bin = bin;
      } else if (Array.isArray(bin)) {
        this.bin = new Uint8Array(bin);
      } else {
        throw new TypeError("ReaderUint8Array constructor: bin must be Uint8Array or number[]");
      }
      this.pos = pos;
      this.length = this.bin.length;
    }
    static makeReader(bin, pos = 0) {
      if (bin instanceof Uint8Array) {
        return new _ReaderUint8Array(bin, pos);
      }
      if (Array.isArray(bin)) {
        return new Reader(bin, pos);
      }
      throw new Error("ReaderUint8Array.makeReader: bin must be Uint8Array or number[]");
    }
    eof() {
      return this.pos >= this.length;
    }
    read(len = this.length) {
      const start = this.pos;
      const end = this.pos + len;
      this.pos = end;
      return this.bin.slice(start, end);
    }
    readReverse(len = this.length) {
      const buf2 = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        buf2[i] = this.bin[this.pos + len - 1 - i];
      }
      this.pos += len;
      return buf2;
    }
    readUInt8() {
      const val2 = this.bin[this.pos];
      this.pos += 1;
      return val2;
    }
    readInt8() {
      const val2 = this.bin[this.pos];
      this.pos += 1;
      return (val2 & 128) === 0 ? val2 : val2 - 256;
    }
    readUInt16BE() {
      const val2 = this.bin[this.pos] << 8 | this.bin[this.pos + 1];
      this.pos += 2;
      return val2;
    }
    readInt16BE() {
      const val2 = this.readUInt16BE();
      return (val2 & 32768) === 0 ? val2 : val2 - 65536;
    }
    readUInt16LE() {
      const val2 = this.bin[this.pos] | this.bin[this.pos + 1] << 8;
      this.pos += 2;
      return val2;
    }
    readInt16LE() {
      const val2 = this.readUInt16LE();
      const x = (val2 & 32768) === 0 ? val2 : val2 - 65536;
      return x;
    }
    readUInt32BE() {
      const val2 = this.bin[this.pos] * 16777216 + // Shift the first byte by 24 bits
      (this.bin[this.pos + 1] << 16 | // Shift the second byte by 16 bits
      this.bin[this.pos + 2] << 8 | // Shift the third byte by 8 bits
      this.bin[this.pos + 3]);
      this.pos += 4;
      return val2;
    }
    readInt32BE() {
      const val2 = this.readUInt32BE();
      return (val2 & 2147483648) === 0 ? val2 : val2 - 4294967296;
    }
    readUInt32LE() {
      const val2 = (this.bin[this.pos] | this.bin[this.pos + 1] << 8 | this.bin[this.pos + 2] << 16 | this.bin[this.pos + 3] << 24) >>> 0;
      this.pos += 4;
      return val2;
    }
    readInt32LE() {
      const val2 = this.readUInt32LE();
      return (val2 & 2147483648) === 0 ? val2 : val2 - 4294967296;
    }
    readUInt64BEBn() {
      const bin = Array.from(this.bin.slice(this.pos, this.pos + 8));
      const bn = new BigNumber(bin);
      this.pos = this.pos + 8;
      return bn;
    }
    readUInt64LEBn() {
      const bin = Array.from(this.readReverse(8));
      const bn = new BigNumber(bin);
      return bn;
    }
    readInt64LEBn() {
      const OverflowInt642 = new BigNumber(2).pow(new BigNumber(63));
      const OverflowUint642 = new BigNumber(2).pow(new BigNumber(64));
      const bin = Array.from(this.readReverse(8));
      let bn = new BigNumber(bin);
      if (bn.gte(OverflowInt642)) {
        bn = bn.sub(OverflowUint642);
      }
      return bn;
    }
    readVarIntNum(signed = true) {
      const first = this.readUInt8();
      let bn;
      switch (first) {
        case 253:
          return this.readUInt16LE();
        case 254:
          return this.readUInt32LE();
        case 255:
          bn = signed ? this.readInt64LEBn() : this.readUInt64LEBn();
          if (bn.lte(new BigNumber(2).pow(new BigNumber(53)))) {
            return bn.toNumber();
          } else {
            throw new Error("number too large to retain precision - use readVarIntBn");
          }
        default:
          return first;
      }
    }
    readVarInt() {
      const first = this.bin[this.pos];
      switch (first) {
        case 253:
          return this.read(1 + 2);
        case 254:
          return this.read(1 + 4);
        case 255:
          return this.read(1 + 8);
        default:
          return this.read(1);
      }
    }
    readVarIntBn() {
      const first = this.readUInt8();
      switch (first) {
        case 253:
          return new BigNumber(this.readUInt16LE());
        case 254:
          return new BigNumber(this.readUInt32LE());
        case 255:
          return this.readUInt64LEBn();
        default:
          return new BigNumber(first);
      }
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/utils.js
  var BufferCtor3 = typeof globalThis === "undefined" ? void 0 : globalThis.Buffer;
  var CAN_USE_BUFFER3 = BufferCtor3 != null && typeof BufferCtor3.from === "function";
  var zero2 = (word) => {
    if (word.length % 2 === 1) {
      return "0" + word;
    } else {
      return word;
    }
  };
  var HEX_DIGITS2 = "0123456789abcdef";
  var HEX_BYTE_STRINGS2 = new Array(256);
  for (let i = 0; i < 256; i++) {
    HEX_BYTE_STRINGS2[i] = HEX_DIGITS2[i >> 4 & 15] + HEX_DIGITS2[i & 15];
  }
  var toHex = (msg) => {
    if (CAN_USE_BUFFER3) {
      return BufferCtor3.from(msg).toString("hex");
    }
    if (msg.length === 0)
      return "";
    const out = new Array(msg.length);
    for (let i = 0; i < msg.length; i++) {
      out[i] = HEX_BYTE_STRINGS2[msg[i] & 255];
    }
    return out.join("");
  };
  var toUint8Array = (msg, enc) => {
    if (msg instanceof Uint8Array)
      return msg;
    return new Uint8Array(toArray2(msg, enc));
  };
  var toArray2 = (msg, enc) => {
    if (Array.isArray(msg))
      return msg.slice();
    if (msg === void 0)
      return [];
    if (typeof msg !== "string") {
      return Array.from(msg, (item) => Math.trunc(item));
    }
    switch (enc) {
      case "hex":
        return hexToArray(msg);
      case "base64":
        return base64ToArray(msg);
      default:
        return utf8ToArray(msg);
    }
  };
  var HEX_CHAR_TO_VALUE2 = new Int8Array(256).fill(-1);
  for (let i = 0; i < 10; i++) {
    HEX_CHAR_TO_VALUE2[48 + i] = i;
  }
  for (let i = 0; i < 6; i++) {
    HEX_CHAR_TO_VALUE2[65 + i] = 10 + i;
    HEX_CHAR_TO_VALUE2[97 + i] = 10 + i;
  }
  var hexToArray = (msg) => {
    assertValidHex(msg);
    const normalized = msg.length % 2 === 0 ? msg : "0" + msg;
    if (CAN_USE_BUFFER3) {
      return Array.from(BufferCtor3.from(normalized, "hex"));
    }
    const out = new Array(normalized.length / 2);
    let o = 0;
    for (let i = 0; i < normalized.length; i += 2) {
      const hi = HEX_CHAR_TO_VALUE2[normalized.codePointAt(i)];
      const lo = HEX_CHAR_TO_VALUE2[normalized.codePointAt(i + 1)];
      out[o++] = hi << 4 | lo;
    }
    return out;
  };
  function base64ToArray(msg) {
    if (typeof msg !== "string") {
      throw new TypeError("msg must be a string");
    }
    let s2 = msg.trim().replaceAll(/[\r\n\t\f\v ]+/g, "");
    s2 = s2.replaceAll("-", "+").replaceAll("_", "/");
    const padIndex = s2.indexOf("=");
    if (padIndex !== -1) {
      const pad = s2.slice(padIndex);
      if (!/^={1,2}$/.test(pad)) {
        throw new Error("Invalid base64 padding");
      }
      if (s2.slice(0, padIndex).includes("=")) {
        throw new Error("Invalid base64 padding");
      }
      s2 = s2.slice(0, padIndex);
    }
    const result = [];
    let bitBuffer = 0;
    let bitCount = 0;
    for (let i = 0; i < s2.length; i++) {
      const c = s2.codePointAt(i);
      let v = -1;
      if (c >= 65 && c <= 90) {
        v = c - 65;
      } else if (c >= 97 && c <= 122) {
        v = c - 97 + 26;
      } else if (c >= 48 && c <= 57) {
        v = c - 48 + 52;
      } else if (c === 43) {
        v = 62;
      } else if (c === 47) {
        v = 63;
      } else {
        throw new Error(`Invalid base64 character at index ${i}`);
      }
      bitBuffer = bitBuffer << 6 | v;
      bitCount += 6;
      while (bitCount >= 8) {
        bitCount -= 8;
        result.push(bitBuffer >> bitCount & 255);
        bitBuffer &= (1 << bitCount) - 1;
      }
    }
    return result;
  }
  function utf8ToArray(str) {
    return Array.from(new TextEncoder().encode(str));
  }
  var toUTF8 = (arr) => {
    return new TextDecoder().decode(new Uint8Array(arr));
  };
  var encode = (arr, enc) => {
    switch (enc) {
      case "hex":
        return toHex(arr);
      case "utf8":
        return toUTF8(arr);
      default:
        return arr;
    }
  };
  function toBase64(byteArray) {
    const base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let result = "";
    let i;
    for (i = 0; i < byteArray.length; i += 3) {
      const byte1 = byteArray[i];
      const byte2 = i + 1 < byteArray.length ? byteArray[i + 1] : 0;
      const byte3 = i + 2 < byteArray.length ? byteArray[i + 2] : 0;
      const encoded1 = byte1 >> 2;
      const encoded2 = (byte1 & 3) << 4 | byte2 >> 4;
      const encoded3 = (byte2 & 15) << 2 | byte3 >> 6;
      const encoded4 = byte3 & 63;
      result += base64Chars.charAt(encoded1) + base64Chars.charAt(encoded2);
      result += i + 1 < byteArray.length ? base64Chars.charAt(encoded3) : "=";
      result += i + 2 < byteArray.length ? base64Chars.charAt(encoded4) : "=";
    }
    return result;
  }
  var base58chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  var fromBase58 = (str) => {
    if (str === "" || typeof str !== "string") {
      throw new Error(`Expected base58 string but got \u201C${str}\u201D`);
    }
    const match = str.match(/[IOl0]/gmu);
    if (match !== null) {
      throw new Error(`Invalid base58 character \u201C${match.join("")}\u201D`);
    }
    const lz = str.match(/^1+/gmu);
    const psz = lz === null ? 0 : lz[0].length;
    const size = (str.length - psz) * (Math.log(58) / Math.log(256)) + 1 >>> 0;
    const uint8 = new Uint8Array([
      ...new Uint8Array(psz),
      ...(str.match(/./gmu) ?? []).map((i) => base58chars.indexOf(i)).reduce((acc, i) => {
        acc = acc.map((j) => {
          const x = j * 58 + i;
          i = x >> 8;
          return x;
        });
        return acc;
      }, new Uint8Array(size)).reverse().filter(/* @__PURE__ */ ((lastValue) => (value) => (
        // @ts-expect-error
        lastValue = lastValue || value
      ))(false))
    ]);
    return [...uint8];
  };
  var toBase58 = (bin) => {
    const base58Map = new Array(256).fill(-1);
    for (let i = 0; i < base58chars.length; ++i) {
      base58Map[base58chars.codePointAt(i)] = i;
    }
    const result = [];
    for (const byte of bin) {
      let carry = byte;
      for (let j = 0; j < result.length; ++j) {
        const x = (base58Map[result[j]] << 8) + carry;
        result[j] = base58chars.codePointAt(x % 58);
        carry = Math.trunc(x / 58);
      }
      while (carry !== 0) {
        result.push(base58chars.codePointAt(carry % 58));
        carry = Math.trunc(carry / 58);
      }
    }
    for (const byte of bin) {
      if (byte === 0)
        result.push("1".codePointAt(0));
      else
        break;
    }
    result.reverse();
    return String.fromCodePoint(...result);
  };
  var toBase58Check = (bin, prefix = [0]) => {
    let hash = hash256([...prefix, ...bin]);
    hash = [...prefix, ...bin, ...hash.slice(0, 4)];
    return toBase58(hash);
  };
  var fromBase58Check = (str, enc, prefixLength = 1) => {
    const bin = fromBase58(str);
    let prefix = bin.slice(0, prefixLength);
    let data = bin.slice(prefixLength, -4);
    let hash = [...prefix, ...data];
    hash = hash256(hash);
    bin.slice(-4).forEach((check, index) => {
      if (check !== hash[index]) {
        throw new Error("Invalid checksum");
      }
    });
    if (enc === "hex") {
      prefix = toHex(prefix);
      data = toHex(data);
    }
    return { prefix, data };
  };
  var Writer = class _Writer {
    constructor(bufs) {
      __publicField(this, "bufs");
      __publicField(this, "length");
      this.bufs = bufs ?? [];
      this.length = 0;
      for (const b of this.bufs)
        this.length += b.length;
    }
    getLength() {
      return this.length;
    }
    toUint8Array() {
      const out = new Uint8Array(this.length);
      let offset = 0;
      for (const buf of this.bufs) {
        out.set(buf, offset);
        offset += buf.length;
      }
      return out;
    }
    toArray() {
      const totalLength = this.length;
      const ret = new Array(totalLength);
      let offset = 0;
      for (const buf of this.bufs) {
        if (buf instanceof Uint8Array) {
          for (const byte of buf) {
            ret[offset++] = byte;
          }
        } else {
          const arr = buf;
          for (const item of arr) {
            ret[offset++] = item;
          }
        }
      }
      return ret;
    }
    toHex() {
      return this.toArray().map((n) => n.toString(16).padStart(2, "0")).join("");
    }
    write(buf) {
      this.bufs.push(buf);
      this.length += buf.length;
      return this;
    }
    writeReverse(buf) {
      const buf2 = new Array(buf.length);
      for (let i = 0; i < buf2.length; i++) {
        buf2[i] = buf[buf.length - 1 - i];
      }
      return this.write(buf2);
    }
    writeUInt8(n) {
      const buf = new Array(1);
      buf[0] = n & 255;
      this.write(buf);
      return this;
    }
    writeInt8(n) {
      return this.writeUInt8(n);
    }
    writeUInt16BE(n) {
      const buf = [
        n >> 8 & 255,
        // shift right 8 bits to get the high byte
        n & 255
        // low byte is just the last 8 bits
      ];
      return this.write(buf);
    }
    writeInt16BE(n) {
      return this.writeUInt16BE(n & 65535);
    }
    writeUInt16LE(n) {
      const buf = [
        n & 255,
        // low byte is just the last 8 bits
        n >> 8 & 255
        // shift right 8 bits to get the high byte
      ];
      return this.write(buf);
    }
    writeInt16LE(n) {
      return this.writeUInt16LE(n & 65535);
    }
    writeUInt32BE(n) {
      const buf = [
        n >> 24 & 255,
        // highest byte
        n >> 16 & 255,
        n >> 8 & 255,
        n & 255
        // lowest byte
      ];
      return this.write(buf);
    }
    writeInt32BE(n) {
      return this.writeUInt32BE(n >>> 0);
    }
    writeUInt32LE(n) {
      const buf = [
        n & 255,
        // lowest byte
        n >> 8 & 255,
        n >> 16 & 255,
        n >> 24 & 255
        // highest byte
      ];
      return this.write(buf);
    }
    writeInt32LE(n) {
      return this.writeUInt32LE(n >>> 0);
    }
    writeUInt64BEBn(bn) {
      const buf = bn.toArray("be", 8);
      this.write(buf);
      return this;
    }
    writeUInt64LEBn(bn) {
      const buf = bn.toArray("be", 8);
      this.writeReverse(buf);
      return this;
    }
    writeUInt64LE(n) {
      if (n === -1) {
        this.write(new Array(8).fill(255));
      } else {
        const buf = new BigNumber(n).toArray("be", 8);
        this.writeReverse(buf);
      }
      return this;
    }
    writeVarIntNum(n) {
      const buf = _Writer.varIntNum(n);
      this.write(buf);
      return this;
    }
    writeVarIntBn(bn) {
      const buf = _Writer.varIntBn(bn);
      this.write(buf);
      return this;
    }
    static varIntNum(n) {
      let buf;
      if (n < 0) {
        return this.varIntBn(new BigNumber(n));
      }
      if (n < 253) {
        buf = [n];
      } else if (n < 65536) {
        buf = [
          253,
          // 0xfd
          n & 255,
          // low byte
          n >> 8 & 255
          // high byte
        ];
      } else if (n < 4294967296) {
        buf = [
          254,
          // 0xfe
          n & 255,
          n >> 8 & 255,
          n >> 16 & 255,
          n >> 24 & 255
        ];
      } else {
        const low = n & 4294967295;
        const high = Math.floor(n / 4294967296) & 4294967295;
        buf = [
          255,
          // 0xff
          low & 255,
          low >> 8 & 255,
          low >> 16 & 255,
          low >> 24 & 255,
          high & 255,
          high >> 8 & 255,
          high >> 16 & 255,
          high >> 24 & 255
        ];
      }
      return buf;
    }
    static varIntBn(bn) {
      let buf;
      if (bn.isNeg()) {
        bn = bn.add(OverflowUint64);
      }
      if (bn.ltn(253)) {
        const n = bn.toNumber();
        buf = [n];
      } else if (bn.ltn(65536)) {
        const n = bn.toNumber();
        buf = [253, n & 255, n >> 8 & 255];
      } else if (bn.lt(new BigNumber(4294967296))) {
        const n = bn.toNumber();
        buf = [
          254,
          n & 255,
          n >> 8 & 255,
          n >> 16 & 255,
          n >> 24 & 255
        ];
      } else {
        const bw = new _Writer();
        bw.writeUInt8(255);
        bw.writeUInt64LEBn(bn);
        buf = bw.toArray();
      }
      return buf;
    }
  };
  var Reader = class {
    constructor(bin = [], pos = 0) {
      __publicField(this, "bin");
      __publicField(this, "pos");
      __publicField(this, "length");
      this.bin = bin;
      this.pos = pos;
      this.length = bin.length;
    }
    eof() {
      return this.pos >= this.length;
    }
    read(len = this.length) {
      const start = this.pos;
      const end = this.pos + len;
      this.pos = end;
      return this.bin.slice(start, end);
    }
    readReverse(len = this.length) {
      const buf2 = new Array(len);
      for (let i = 0; i < len; i++) {
        buf2[i] = this.bin[this.pos + len - 1 - i];
      }
      this.pos += len;
      return buf2;
    }
    readUInt8() {
      const val2 = this.bin[this.pos];
      this.pos += 1;
      return val2;
    }
    readInt8() {
      const val2 = this.bin[this.pos];
      this.pos += 1;
      return (val2 & 128) === 0 ? val2 : val2 - 256;
    }
    readUInt16BE() {
      const val2 = this.bin[this.pos] << 8 | this.bin[this.pos + 1];
      this.pos += 2;
      return val2;
    }
    readInt16BE() {
      const val2 = this.readUInt16BE();
      return (val2 & 32768) === 0 ? val2 : val2 - 65536;
    }
    readUInt16LE() {
      const val2 = this.bin[this.pos] | this.bin[this.pos + 1] << 8;
      this.pos += 2;
      return val2;
    }
    readInt16LE() {
      const val2 = this.readUInt16LE();
      const x = (val2 & 32768) === 0 ? val2 : val2 - 65536;
      return x;
    }
    readUInt32BE() {
      const val2 = this.bin[this.pos] * 16777216 + // Shift the first byte by 24 bits
      (this.bin[this.pos + 1] << 16 | // Shift the second byte by 16 bits
      this.bin[this.pos + 2] << 8 | // Shift the third byte by 8 bits
      this.bin[this.pos + 3]);
      this.pos += 4;
      return val2;
    }
    readInt32BE() {
      const val2 = this.readUInt32BE();
      return (val2 & 2147483648) === 0 ? val2 : val2 - 4294967296;
    }
    readUInt32LE() {
      const val2 = (this.bin[this.pos] | this.bin[this.pos + 1] << 8 | this.bin[this.pos + 2] << 16 | this.bin[this.pos + 3] << 24) >>> 0;
      this.pos += 4;
      return val2;
    }
    readInt32LE() {
      const val2 = this.readUInt32LE();
      return (val2 & 2147483648) === 0 ? val2 : val2 - 4294967296;
    }
    readUInt64BEBn() {
      const bin = this.bin.slice(this.pos, this.pos + 8);
      const bn = new BigNumber(bin);
      this.pos = this.pos + 8;
      return bn;
    }
    readUInt64LEBn() {
      const bin = this.readReverse(8);
      const bn = new BigNumber(bin);
      return bn;
    }
    readInt64LEBn() {
      const bin = this.readReverse(8);
      let bn = new BigNumber(bin);
      if (bn.gte(OverflowInt64)) {
        bn = bn.sub(OverflowUint64);
      }
      return bn;
    }
    readVarIntNum(signed = true) {
      const first = this.readUInt8();
      let bn;
      switch (first) {
        case 253:
          return this.readUInt16LE();
        case 254:
          return this.readUInt32LE();
        case 255:
          bn = signed ? this.readInt64LEBn() : this.readUInt64LEBn();
          if (bn.lte(new BigNumber(2).pow(new BigNumber(53)))) {
            return bn.toNumber();
          } else {
            throw new Error("number too large to retain precision - use readVarIntBn");
          }
        default:
          return first;
      }
    }
    readVarInt() {
      const first = this.bin[this.pos];
      switch (first) {
        case 253:
          return this.read(1 + 2);
        case 254:
          return this.read(1 + 4);
        case 255:
          return this.read(1 + 8);
        default:
          return this.read(1);
      }
    }
    readVarIntBn() {
      const first = this.readUInt8();
      switch (first) {
        case 253:
          return new BigNumber(this.readUInt16LE());
        case 254:
          return new BigNumber(this.readUInt32LE());
        case 255:
          return this.readUInt64LEBn();
        default:
          return new BigNumber(first);
      }
    }
  };
  var minimallyEncode = (buf) => {
    if (buf.length === 0) {
      return buf;
    }
    const last = buf.at(-1);
    if ((last & 127) !== 0) {
      return buf;
    }
    if (buf.length === 1) {
      return [];
    }
    if ((buf.at(-2) & 128) !== 0) {
      return buf;
    }
    for (let i = buf.length - 1; i > 0; i--) {
      if (buf[i - 1] !== 0) {
        if ((buf[i - 1] & 128) === 0) {
          buf[i - 1] |= last;
          return buf.slice(0, i);
        } else {
          buf[i] = last;
          return buf.slice(0, i + 1);
        }
      }
    }
    return [];
  };
  var OverflowInt64 = new BigNumber(2).pow(new BigNumber(63));
  var OverflowUint64 = new BigNumber(2).pow(new BigNumber(64));
  function verifyNotNull(value, errorMessage = "Expected a valid value, but got undefined or null.") {
    if (value == null)
      throw new Error(errorMessage);
    return value;
  }
  function constantTimeEquals(a, b) {
    if (a.length !== b.length)
      return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff |= a[i] ^ b[i];
    }
    return diff === 0;
  }

  // node_modules/@bsv/sdk/dist/esm/src/primitives/Point.js
  function ctSwap(swap, a, b) {
    const mask = -swap;
    const swapX = (a.X ^ b.X) & mask;
    const swapY = (a.Y ^ b.Y) & mask;
    const swapZ = (a.Z ^ b.Z) & mask;
    a.X ^= swapX;
    b.X ^= swapX;
    a.Y ^= swapY;
    b.Y ^= swapY;
    a.Z ^= swapZ;
    b.Z ^= swapZ;
  }
  var BI_ZERO = 0n;
  var BI_ONE = 1n;
  var BI_TWO = 2n;
  var BI_THREE = 3n;
  var BI_FOUR = 4n;
  var BI_EIGHT = 8n;
  var P_BIGINT = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
  var N_BIGINT = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  var MASK_256 = (1n << 256n) - 1n;
  function red(x) {
    let hi = x >> 256n;
    x = (x & MASK_256) + (hi << 32n) + hi * 977n;
    hi = x >> 256n;
    x = (x & MASK_256) + (hi << 32n) + hi * 977n;
    if (x >= P_BIGINT)
      x -= P_BIGINT;
    return x;
  }
  var biMod = (a) => red((a % P_BIGINT + P_BIGINT) % P_BIGINT);
  var biModSub = (a, b) => a >= b ? a - b : P_BIGINT - (b - a);
  var biModMul = (a, b) => red(a * b);
  var biModAdd = (a, b) => red(a + b);
  var biModInv = (a) => {
    let lm = BI_ONE;
    let hm = BI_ZERO;
    let low = biMod(a);
    let high = P_BIGINT;
    while (low > BI_ONE) {
      const r2 = high / low;
      [lm, hm] = [hm - lm * r2, lm];
      [low, high] = [high - low * r2, low];
    }
    return biMod(lm);
  };
  var biModSqr = (a) => biModMul(a, a);
  var biModPow = (base, exp) => {
    let result = 1n;
    base = biMod(base);
    while (exp > 0n) {
      if ((exp & 1n) !== 0n) {
        result = biModMul(result, base);
      }
      base = biModMul(base, base);
      exp >>= 1n;
    }
    return result;
  };
  var P_PLUS1_DIV4 = P_BIGINT + 1n >> 2n;
  var biModSqrt = (a) => {
    const r2 = biModPow(a, P_PLUS1_DIV4);
    if (biModMul(r2, r2) !== biMod(a)) {
      return null;
    }
    return r2;
  };
  var toBigInt = (x) => {
    if (BigNumber.isBN(x))
      return BigInt("0x" + x.toString(16));
    if (typeof x === "string")
      return BigInt("0x" + x);
    if (Array.isArray(x))
      return BigInt("0x" + toHex(x));
    return BigInt(x);
  };
  var GX_BIGINT = BigInt("0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798");
  var GY_BIGINT = BigInt("0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8");
  var WNAF_TABLE_CACHE = /* @__PURE__ */ new Map();
  var jpDouble = (P2) => {
    const { X: X1, Y: Y1, Z: Z1 } = P2;
    if (Y1 === BI_ZERO)
      return { X: BI_ZERO, Y: BI_ONE, Z: BI_ZERO };
    const Y1sq = biModMul(Y1, Y1);
    const S = biModMul(BI_FOUR, biModMul(X1, Y1sq));
    const M = biModMul(BI_THREE, biModMul(X1, X1));
    const X3 = biModSub(biModMul(M, M), biModMul(BI_TWO, S));
    const Y3 = biModSub(biModMul(M, biModSub(S, X3)), biModMul(BI_EIGHT, biModMul(Y1sq, Y1sq)));
    const Z3 = biModMul(BI_TWO, biModMul(Y1, Z1));
    return { X: X3, Y: Y3, Z: Z3 };
  };
  var jpAdd = (P2, Q) => {
    if (P2.Z === BI_ZERO)
      return Q;
    if (Q.Z === BI_ZERO)
      return P2;
    const Z1Z1 = biModMul(P2.Z, P2.Z);
    const Z2Z2 = biModMul(Q.Z, Q.Z);
    const U1 = biModMul(P2.X, Z2Z2);
    const U2 = biModMul(Q.X, Z1Z1);
    const S1 = biModMul(P2.Y, biModMul(Z2Z2, Q.Z));
    const S2 = biModMul(Q.Y, biModMul(Z1Z1, P2.Z));
    const H = biModSub(U2, U1);
    const r2 = biModSub(S2, S1);
    if (H === BI_ZERO) {
      if (r2 === BI_ZERO)
        return jpDouble(P2);
      return { X: BI_ZERO, Y: BI_ONE, Z: BI_ZERO };
    }
    const HH = biModMul(H, H);
    const HHH = biModMul(H, HH);
    const V = biModMul(U1, HH);
    const X3 = biModSub(biModSub(biModMul(r2, r2), HHH), biModMul(BI_TWO, V));
    const Y3 = biModSub(biModMul(r2, biModSub(V, X3)), biModMul(S1, HHH));
    const Z3 = biModMul(H, biModMul(P2.Z, Q.Z));
    return { X: X3, Y: Y3, Z: Z3 };
  };
  var jpNeg = (P2) => {
    if (P2.Z === BI_ZERO)
      return P2;
    return { X: P2.X, Y: P_BIGINT - P2.Y, Z: P2.Z };
  };
  var scalarMultiplyWNAF = (k, P0, window2 = 5) => {
    const key2 = `${window2}:${P0.x.toString(16)}:${P0.y.toString(16)}`;
    let tbl = WNAF_TABLE_CACHE.get(key2);
    if (tbl === void 0) {
      const tblSize = 1 << window2 - 1;
      tbl = new Array(tblSize);
      const P2 = { X: P0.x, Y: P0.y, Z: BI_ONE };
      tbl[0] = P2;
      const twoP = jpDouble(P2);
      for (let i = 1; i < tblSize; i++) {
        tbl[i] = jpAdd(tbl[i - 1], twoP);
      }
      WNAF_TABLE_CACHE.set(key2, tbl);
    }
    const wnaf = [];
    const wBig = 1n << BigInt(window2);
    const wHalf = wBig >> 1n;
    let kTmp = k;
    while (kTmp > 0n) {
      if ((kTmp & BI_ONE) === BI_ZERO) {
        wnaf.push(0);
        kTmp >>= BI_ONE;
      } else {
        let z = kTmp & wBig - 1n;
        if (z > wHalf)
          z -= wBig;
        wnaf.push(Number(z));
        kTmp -= z;
        kTmp >>= BI_ONE;
      }
    }
    let Q = { X: BI_ZERO, Y: BI_ONE, Z: BI_ZERO };
    for (let i = wnaf.length - 1; i >= 0; i--) {
      Q = jpDouble(Q);
      const di = wnaf[i];
      if (di !== 0) {
        const idx = Math.abs(di) >> 1;
        const addend = di > 0 ? tbl[idx] : jpNeg(tbl[idx]);
        Q = jpAdd(Q, addend);
      }
    }
    return Q;
  };
  var modN = (a) => {
    let r2 = a % N_BIGINT;
    if (r2 < 0n)
      r2 += N_BIGINT;
    return r2;
  };
  var modMulN = (a, b) => modN(a * b);
  var modInvN = (a) => {
    let lm = 1n;
    let hm = 0n;
    let low = modN(a);
    let high = N_BIGINT;
    while (low > 1n) {
      const q = high / low;
      [lm, hm] = [hm - lm * q, lm];
      [low, high] = [high - low * q, low];
    }
    return modN(lm);
  };
  var Point = class _Point extends BasePoint {
    /**
     * @constructor
     * @param x - The x-coordinate of the point. May be a number, a BigNumber, a string (which will be interpreted as hex), a number array, or null. If null, an "Infinity" point is constructed.
     * @param y - The y-coordinate of the point, similar to x.
     * @param isRed - A boolean indicating if the point is a member of the field of integers modulo the k256 prime. Default is true.
     *
     * @example
     * new Point('abc123', 'def456');
     * new Point(null, null); // Generates Infinity point.
     */
    constructor(x, y, isRed = true) {
      super("affine");
      __publicField(this, "x");
      __publicField(this, "y");
      __publicField(this, "inf");
      this.precomputed = null;
      if (x === null && y === null) {
        this.x = null;
        this.y = null;
        this.inf = true;
      } else {
        if (!BigNumber.isBN(x)) {
          x = new BigNumber(x, 16);
        }
        this.x = x;
        if (!BigNumber.isBN(y)) {
          y = new BigNumber(y, 16);
        }
        this.y = y;
        if (isRed) {
          this.x.forceRed(this.curve.red);
          this.y.forceRed(this.curve.red);
        }
        if (this.x.red === null) {
          this.x = this.x.toRed(this.curve.red);
        }
        if (this.y.red === null) {
          this.y = this.y.toRed(this.curve.red);
        }
        this.inf = false;
      }
    }
    static _assertOnCurve(p) {
      if (!p.validate()) {
        throw new Error("Invalid point");
      }
      return p;
    }
    /**
     * Creates a point object from a given Array. These numbers can represent coordinates in hex format, or points
     * in multiple established formats.
     * The function verifies the integrity of the provided data and throws errors if inconsistencies are found.
     *
     * @method fromDER
     * @static
     * @param bytes - The point representation number array.
     * @returns Returns a new point representing the given string.
     * @throws `Error` If the point number[] value has a wrong length.
     * @throws `Error` If the point format is unknown.
     *
     * @example
     * const derPoint = [ 2, 18, 123, 108, 125, 83, 1, 251, 164, 214, 16, 119, 200, 216, 210, 193, 251, 193, 129, 67, 97, 146, 210, 216, 77, 254, 18, 6, 150, 190, 99, 198, 128 ];
     * const point = Point.fromDER(derPoint);
     */
    static fromDER(bytes2) {
      const len = 32;
      if ((bytes2[0] === 4 || bytes2[0] === 6 || bytes2[0] === 7) && bytes2.length - 1 === 2 * len) {
        if (bytes2[0] === 6) {
          if (bytes2.at(-1) % 2 !== 0) {
            throw new Error("Point string value is wrong length");
          }
        } else if (bytes2[0] === 7) {
          if (bytes2.at(-1) % 2 !== 1) {
            throw new Error("Point string value is wrong length");
          }
        }
        const res = new _Point(bytes2.slice(1, 1 + len), bytes2.slice(1 + len, 1 + 2 * len));
        return _Point._assertOnCurve(res);
      } else if ((bytes2[0] === 2 || bytes2[0] === 3) && bytes2.length - 1 === len) {
        return _Point._assertOnCurve(_Point.fromX(bytes2.slice(1, 1 + len), bytes2[0] === 3));
      }
      throw new Error("Unknown point format");
    }
    /**
     * Creates a point object from a given string. This string can represent coordinates in hex format, or points
     * in multiple established formats.
     * The function verifies the integrity of the provided data and throws errors if inconsistencies are found.
     *
     * @method fromString
     * @static
     *
     * @param str The point representation string.
     * @returns Returns a new point representing the given string.
     * @throws `Error` If the point string value has a wrong length.
     * @throws `Error` If the point format is unknown.
     *
     * @example
     * const pointStr = 'abcdef';
     * const point = Point.fromString(pointStr);
     */
    static fromString(str) {
      const bytes2 = toArray2(str, "hex");
      return _Point._assertOnCurve(_Point.fromDER(bytes2));
    }
    /**
     * Generates a point from an x coordinate and a boolean indicating whether the corresponding
     * y coordinate is odd.
     *
     * @method fromX
     * @static
     * @param x - The x coordinate of the point.
     * @param odd - Boolean indicating whether the corresponding y coordinate is odd or not.
     * @returns Returns the new point.
     * @throws `Error` If the point is invalid.
     *
     * @example
     * const xCoordinate = new BigNumber('10');
     * const point = Point.fromX(xCoordinate, true);
     */
    static fromX(x, odd) {
      let xBigInt = toBigInt(x);
      xBigInt = biMod(xBigInt);
      const y2 = biModAdd(biModMul(biModSqr(xBigInt), xBigInt), 7n);
      const y = biModSqrt(y2);
      if (y === null) {
        throw new Error("Invalid point");
      }
      let yBig = y;
      if ((yBig & BI_ONE) !== (odd ? BI_ONE : BI_ZERO)) {
        yBig = biModSub(P_BIGINT, yBig);
      }
      const xBN = new BigNumber(xBigInt.toString(16), 16);
      const yBN = new BigNumber(yBig.toString(16), 16);
      return _Point._assertOnCurve(new _Point(xBN, yBN));
    }
    /**
     * Generates a point from a serialized JSON object. The function accounts for different options in the JSON object,
     * including precomputed values for optimization of EC operations, and calls another helper function to turn nested
     * JSON points into proper Point objects.
     *
     * @method fromJSON
     * @static
     * @param obj - An object or array that holds the data for the point.
     * @param isRed - A boolean to direct how the Point is constructed from the JSON object.
     * @returns Returns a new point based on the deserialized JSON object.
     *
     * @example
     * const serializedPoint = '{"x":52,"y":15}';
     * const point = Point.fromJSON(serializedPoint, true);
     */
    static fromJSON(obj, isRed) {
      if (typeof obj === "string") {
        obj = JSON.parse(obj);
      }
      let res = new _Point(obj[0], obj[1], isRed);
      res = _Point._assertOnCurve(res);
      if (typeof obj[2] !== "object" || obj[2] === null) {
        return res;
      }
      const pre = obj[2];
      const obj2point = (p) => {
        const pt = new _Point(p[0], p[1], isRed);
        return _Point._assertOnCurve(pt);
      };
      res.precomputed = {
        beta: null,
        doubles: typeof pre.doubles === "object" && pre.doubles !== null ? {
          step: pre.doubles.step,
          points: [res].concat(pre.doubles.points.map(obj2point))
        } : void 0,
        naf: typeof pre.naf === "object" && pre.naf !== null ? {
          wnd: pre.naf.wnd,
          points: [res].concat(pre.naf.points.map(obj2point))
        } : void 0
      };
      return res;
    }
    /**
     * Validates if a point belongs to the curve. Follows the short Weierstrass
     * equation for elliptic curves: y^2 = x^3 + ax + b.
     *
     * @method validate
     * @returns {boolean} true if the point is on the curve, false otherwise.
     *
     * @example
     * const aPoint = new Point(x, y);
     * const isValid = aPoint.validate();
     */
    validate() {
      if (this.inf || this.x == null || this.y == null)
        return false;
      try {
        const xBig = BigInt("0x" + this.x.fromRed().toString(16));
        const yBig = BigInt("0x" + this.y.fromRed().toString(16));
        const lhs = biModMul(yBig, yBig);
        const rhs = biModAdd(biModMul(biModMul(xBig, xBig), xBig), 7n);
        return lhs === rhs;
      } catch {
        return false;
      }
    }
    /**
     * Encodes the coordinates of a point into an array or a hexadecimal string.
     * The details of encoding are determined by the optional compact and enc parameters.
     *
     * @method encode
     * @param compact - If true, an additional prefix byte 0x02 or 0x03 based on the 'y' coordinate being even or odd respectively is used. If false, byte 0x04 is used.
     * @param enc - Expects the string 'hex' if hexadecimal string encoding is required instead of an array of numbers.
     * @throws Will throw an error if the specified encoding method is not recognized. Expects 'hex'.
     * @returns If enc is undefined, a byte array representation of the point will be returned. if enc is 'hex', a hexadecimal string representation of the point will be returned.
     *
     * @example
     * const aPoint = new Point(x, y);
     * const encodedPointArray = aPoint.encode();
     * const encodedPointHex = aPoint.encode(true, 'hex');
     */
    encode(compact = true, enc) {
      if (this.inf) {
        if (enc === "hex")
          return "00";
        return [0];
      }
      const len = this.curve.p.byteLength();
      const x = this.getX().toArray("be", len);
      let res;
      if (compact) {
        res = [this.getY().isEven() ? 2 : 3].concat(x);
      } else {
        res = [4].concat(x, this.getY().toArray("be", len));
      }
      if (enc === "hex") {
        return toHex(res);
      } else {
        return res;
      }
    }
    /**
     * Converts the point coordinates to a hexadecimal string. A wrapper method
     * for encode. Byte 0x02 or 0x03 is used as prefix based on the 'y' coordinate being even or odd respectively.
     *
     * @method toString
     * @returns {string} A hexadecimal string representation of the point coordinates.
     *
     * @example
     * const aPoint = new Point(x, y);
     * const stringPoint = aPoint.toString();
     */
    toString() {
      return this.encode(true, "hex");
    }
    /**
     * Exports the x and y coordinates of the point, and the precomputed doubles and non-adjacent form (NAF) for optimization. The output is an array.
     *
     * @method toJSON
     * @returns An Array where first two elements are the coordinates of the point and optional third element is an object with doubles and NAF points.
     *
     * @example
     * const aPoint = new Point(x, y);
     * const jsonPoint = aPoint.toJSON();
     */
    toJSON() {
      if (this.precomputed == null) {
        return [this.x, this.y];
      }
      return [
        this.x,
        this.y,
        typeof this.precomputed === "object" && this.precomputed !== null ? {
          doubles: this.precomputed.doubles == null ? void 0 : {
            step: this.precomputed.doubles.step,
            points: this.precomputed.doubles.points.slice(1)
          },
          naf: this.precomputed.naf == null ? void 0 : {
            wnd: this.precomputed.naf.wnd,
            points: this.precomputed.naf.points.slice(1)
          }
        } : void 0
      ];
    }
    /**
     * Provides the point coordinates in a human-readable string format for debugging purposes.
     *
     * @method inspect
     * @returns String of the format '<EC Point x: x-coordinate y: y-coordinate>', or '<EC Point Infinity>' if the point is at infinity.
     *
     * @example
     * const aPoint = new Point(x, y);
     * console.log(aPoint.inspect());
     */
    inspect() {
      if (this.isInfinity()) {
        return "<EC Point Infinity>";
      }
      return "<EC Point x: " + (this.x?.fromRed()?.toString(16, 2) ?? "undefined") + " y: " + (this.y?.fromRed()?.toString(16, 2) ?? "undefined") + ">";
    }
    /**
     * Checks if the point is at infinity.
     * @method isInfinity
     * @returns Returns whether or not the point is at infinity.
     *
     * @example
     * const p = new Point(null, null);
     * console.log(p.isInfinity()); // outputs: true
     */
    isInfinity() {
      return this.inf;
    }
    /**
     * Adds another Point to this Point, returning a new Point.
     *
     * @method add
     * @param p - The Point to add to this one.
     * @returns A new Point that results from the addition.
     *
     * @example
     * const p1 = new Point(1, 2);
     * const p2 = new Point(2, 3);
     * const result = p1.add(p2);
     */
    add(p) {
      if (this.inf) {
        return p;
      }
      if (p.inf) {
        return this;
      }
      if (this.eq(p)) {
        return this.dbl();
      }
      if (this.neg().eq(p)) {
        return new _Point(null, null);
      }
      if (this.x?.cmp(p.x ?? new BigNumber(0)) === 0) {
        return new _Point(null, null);
      }
      const P1 = {
        X: BigInt("0x" + this.x.fromRed().toString(16)),
        Y: BigInt("0x" + this.y.fromRed().toString(16)),
        Z: BI_ONE
      };
      const Q1 = {
        X: BigInt("0x" + p.x.fromRed().toString(16)),
        Y: BigInt("0x" + p.y.fromRed().toString(16)),
        Z: BI_ONE
      };
      const R2 = jpAdd(P1, Q1);
      if (R2.Z === BI_ZERO)
        return new _Point(null, null);
      const zInv = biModInv(R2.Z);
      const zInv2 = biModMul(zInv, zInv);
      const xRes = biModMul(R2.X, zInv2);
      const yRes = biModMul(R2.Y, biModMul(zInv2, zInv));
      return new _Point(xRes.toString(16), yRes.toString(16));
    }
    /**
     * Doubles the current point.
     *
     * @method dbl
     *
     * @example
     * const P = new Point('123', '456');
     * const result = P.dbl();
     * */
    dbl() {
      if (this.inf)
        return this;
      if (this.x === null || this.y === null) {
        throw new Error("Point coordinates cannot be null");
      }
      const X = BigInt("0x" + this.x.fromRed().toString(16));
      const Y = BigInt("0x" + this.y.fromRed().toString(16));
      if (Y === BI_ZERO)
        return new _Point(null, null);
      const R2 = jpDouble({ X, Y, Z: BI_ONE });
      const zInv = biModInv(R2.Z);
      const zInv2 = biModMul(zInv, zInv);
      const xRes = biModMul(R2.X, zInv2);
      const yRes = biModMul(R2.Y, biModMul(zInv2, zInv));
      return new _Point(xRes.toString(16), yRes.toString(16));
    }
    /**
     * Returns X coordinate of point
     *
     * @example
     * const P = new Point('123', '456');
     * const x = P.getX();
     */
    getX() {
      return (this.x ?? new BigNumber(0)).fromRed();
    }
    /**
     * Returns X coordinate of point
     *
     * @example
     * const P = new Point('123', '456');
     * const x = P.getX();
     */
    getY() {
      return (this.y ?? new BigNumber(0)).fromRed();
    }
    /**
     * Multiplies this Point by a scalar value, returning a new Point.
     *
     * @method mul
     * @param k - The scalar value to multiply this Point by.
     * @returns  A new Point that results from the multiplication.
     *
     * @example
     * const p = new Point(1, 2);
     * const result = p.mul(2); // this doubles the Point
     */
    mul(k) {
      if (!BigNumber.isBN(k)) {
        k = new BigNumber(k, 16);
      }
      k = k;
      if (this.inf) {
        return this;
      }
      const isNeg = k.isNeg();
      const kAbs = isNeg ? k.neg() : k;
      let kBig = BigInt("0x" + kAbs.toString(16));
      kBig = biMod(kBig);
      if (kBig === BI_ZERO) {
        return new _Point(null, null);
      }
      if (kBig === BI_ZERO) {
        return new _Point(null, null);
      }
      if (this.x === null || this.y === null) {
        throw new Error("Point coordinates cannot be null");
      }
      let Px;
      let Py;
      if (this === this.curve.g) {
        Px = GX_BIGINT;
        Py = GY_BIGINT;
      } else {
        Px = BigInt("0x" + this.x.fromRed().toString(16));
        Py = BigInt("0x" + this.y.fromRed().toString(16));
      }
      const R2 = scalarMultiplyWNAF(kBig, { x: Px, y: Py });
      if (R2.Z === BI_ZERO) {
        return new _Point(null, null);
      }
      const zInv = biModInv(R2.Z);
      const zInv2 = biModMul(zInv, zInv);
      const xRes = biModMul(R2.X, zInv2);
      const yRes = biModMul(R2.Y, biModMul(zInv2, zInv));
      const xBN = new BigNumber(xRes.toString(16), 16);
      const yBN = new BigNumber(yRes.toString(16), 16);
      const result = new _Point(xBN, yBN);
      if (isNeg) {
        return result.neg();
      }
      return result;
    }
    mulCT(k) {
      if (!BigNumber.isBN(k)) {
        k = new BigNumber(k, 16);
      }
      k = k;
      if (this.inf)
        return new _Point(null, null);
      const isNeg = k.isNeg();
      const kAbs = isNeg ? k.neg() : k;
      let kBig = BigInt("0x" + kAbs.toString(16));
      kBig = biMod(kBig);
      if (kBig === 0n)
        return new _Point(null, null);
      const Px = this === this.curve.g ? GX_BIGINT : BigInt("0x" + this.getX().toString(16));
      const Py = this === this.curve.g ? GY_BIGINT : BigInt("0x" + this.getY().toString(16));
      let R0 = { X: 0n, Y: 1n, Z: 0n };
      let R1 = { X: Px, Y: Py, Z: 1n };
      const bits = kBig.toString(2);
      for (const bitChar of bits) {
        const bit = bitChar === "1" ? 1n : 0n;
        ctSwap(bit, R0, R1);
        R1 = jpAdd(R0, R1);
        R0 = jpDouble(R0);
        ctSwap(bit, R0, R1);
      }
      if (R0.Z === 0n)
        return new _Point(null, null);
      const zInv = biModInv(R0.Z);
      const zInv2 = biModMul(zInv, zInv);
      const x = biModMul(R0.X, zInv2);
      const y = biModMul(R0.Y, biModMul(zInv2, zInv));
      const result = new _Point(x.toString(16), y.toString(16));
      return isNeg ? result.neg() : result;
    }
    /**
     * Performs a multiplication and addition operation in a single step.
     * Multiplies this Point by k1, adds the resulting Point to the result of p2 multiplied by k2.
     *
     * @method mulAdd
     * @param k1 - The scalar value to multiply this Point by.
     * @param p2 - The other Point to be involved in the operation.
     * @param k2 - The scalar value to multiply the Point p2 by.
     * @returns A Point that results from the combined multiplication and addition operations.
     *
     * @example
     * const p1 = new Point(1, 2);
     * const p2 = new Point(2, 3);
     * const result = p1.mulAdd(2, p2, 3);
     */
    mulAdd(k1, p2, k2) {
      const points = [this, p2];
      const coeffs = [k1, k2];
      return this._endoWnafMulAdd(points, coeffs);
    }
    /**
     * Performs the Jacobian multiplication and addition operation in a single
     * step. Instead of returning a regular Point, the result is a JacobianPoint.
     *
     * @method jmulAdd
     * @param k1 - The scalar value to multiply this Point by.
     * @param p2 - The other Point to be involved in the operation
     * @param k2 - The scalar value to multiply the Point p2 by.
     * @returns A JacobianPoint that results from the combined multiplication and addition operation.
     *
     * @example
     * const p1 = new Point(1, 2);
     * const p2 = new Point(2, 3);
     * const result = p1.jmulAdd(2, p2, 3);
     */
    jmulAdd(k1, p2, k2) {
      const points = [this, p2];
      const coeffs = [k1, k2];
      return this._endoWnafMulAdd(points, coeffs, true);
    }
    /**
     * Checks if the Point instance is equal to another given Point.
     *
     * @method eq
     * @param p - The Point to be checked if equal to the current instance.
     *
     * @returns Whether the two Point instances are equal. Both the 'x' and 'y' coordinates have to match, and both points have to either be valid or at infinity for equality. If both conditions are true, it returns true, else it returns false.
     *
     * @example
     * const p1 = new Point(5, 20);
     * const p2 = new Point(5, 20);
     * const areEqual = p1.eq(p2); // returns true
     */
    eq(p) {
      return this === p || this.inf === p.inf && (this.inf || (this.x ?? new BigNumber(0)).cmp(p.x ?? new BigNumber(0)) === 0 && (this.y ?? new BigNumber(0)).cmp(p.y ?? new BigNumber(0)) === 0);
    }
    /**
     * Negate a point. The negation of a point P is the mirror of P about x-axis.
     *
     * @method neg
     *
     * @example
     * const P = new Point('123', '456');
     * const result = P.neg();
     */
    neg(_precompute) {
      if (this.inf) {
        return this;
      }
      const res = new _Point(this.x, (this.y ?? new BigNumber(0)).redNeg());
      if (_precompute === true && this.precomputed != null) {
        const pre = this.precomputed;
        const negate = (p) => p.neg();
        res.precomputed = {
          naf: pre.naf == null ? void 0 : {
            wnd: pre.naf.wnd,
            points: pre.naf.points.map(negate)
          },
          doubles: pre.doubles == null ? void 0 : {
            step: pre.doubles.step,
            points: pre.doubles.points.map((p) => p.neg())
          },
          beta: void 0
        };
      }
      return res;
    }
    /**
     * Performs the "doubling" operation on the Point a given number of times.
     * This is used in elliptic curve operations to perform multiplication by 2, multiple times.
     * If the point is at infinity, it simply returns the point because doubling
     * a point at infinity is still infinity.
     *
     * @method dblp
     * @param k - The number of times the "doubling" operation is to be performed on the Point.
     * @returns The Point after 'k' "doubling" operations have been performed.
     *
     * @example
     * const p = new Point(5, 20);
     * const doubledPoint = p.dblp(10); // returns the point after "doubled" 10 times
     */
    dblp(k) {
      let r2 = this;
      for (let i = 0; i < k; i++) {
        r2 = r2.dbl();
      }
      return r2;
    }
    /**
     * Converts the point to a Jacobian point. If the point is at infinity, the corresponding Jacobian point
     * will also be at infinity.
     *
     * @method toJ
     * @returns Returns a new Jacobian point based on the current point.
     *
     * @example
     * const point = new Point(xCoordinate, yCoordinate);
     * const jacobianPoint = point.toJ();
     */
    toJ() {
      if (this.inf) {
        return new JacobianPoint(null, null, null);
      }
      const res = new JacobianPoint(this.x, this.y, this.curve.one);
      return res;
    }
    _getBeta() {
      if (typeof this.curve.endo !== "object") {
        return;
      }
      const pre = this.precomputed;
      if (typeof pre === "object" && pre !== null && typeof pre.beta === "object" && pre.beta !== null) {
        return pre.beta;
      }
      const beta = new _Point((this.x ?? new BigNumber(0)).redMul(this.curve.endo.beta), this.y);
      if (pre != null) {
        const curve2 = this.curve;
        const endoMul = (p) => {
          if (p.x === null) {
            throw new Error("p.x is null");
          }
          if (curve2.endo === void 0 || curve2.endo === null) {
            throw new Error("curve.endo is undefined");
          }
          return new _Point(p.x.redMul(curve2.endo.beta), p.y);
        };
        pre.beta = beta;
        beta.precomputed = {
          beta: null,
          naf: pre.naf == null ? void 0 : {
            wnd: pre.naf.wnd,
            points: pre.naf.points.map(endoMul)
          },
          doubles: pre.doubles == null ? void 0 : {
            step: pre.doubles.step,
            points: pre.doubles.points.map(endoMul)
          }
        };
      }
      return beta;
    }
    _fixedNafMul(k) {
      if (typeof this.precomputed !== "object" || this.precomputed === null) {
        throw new Error("_fixedNafMul requires precomputed values for the point");
      }
      const doubles = this._getDoubles();
      const naf = this.curve.getNAF(k, 1, this.curve._bitLength);
      let I = (1 << doubles.step + 1) - (doubles.step % 2 === 0 ? 2 : 1);
      I /= 3;
      const repr = [];
      for (let j = 0; j < naf.length; j += doubles.step) {
        let nafW = 0;
        for (let k2 = j + doubles.step - 1; k2 >= j; k2--) {
          nafW = (nafW << 1) + naf[k2];
        }
        repr.push(nafW);
      }
      let a = new JacobianPoint(null, null, null);
      let b = new JacobianPoint(null, null, null);
      for (let i = I; i > 0; i--) {
        for (let j = 0; j < repr.length; j++) {
          const nafW = repr[j];
          if (nafW === i) {
            b = b.mixedAdd(doubles.points[j]);
          } else if (nafW === -i) {
            b = b.mixedAdd(doubles.points[j].neg());
          }
        }
        a = a.add(b);
      }
      return a.toP();
    }
    _wnafMulAdd(defW, points, coeffs, len, jacobianResult) {
      const wndWidth = this.curve._wnafT1.map((num) => num.toNumber());
      const wnd = this.curve._wnafT2.map(() => []);
      const naf = this.curve._wnafT3.map(() => []);
      let max = 0;
      for (let i = 0; i < len; i++) {
        const p = points[i];
        const nafPoints = p._getNAFPoints(defW);
        wndWidth[i] = nafPoints.wnd;
        wnd[i] = nafPoints.points;
      }
      for (let i = len - 1; i >= 1; i -= 2) {
        const a = i - 1;
        const b = i;
        if (wndWidth[a] !== 1 || wndWidth[b] !== 1) {
          naf[a] = this.curve.getNAF(coeffs[a], wndWidth[a], this.curve._bitLength);
          naf[b] = this.curve.getNAF(coeffs[b], wndWidth[b], this.curve._bitLength);
          max = Math.max(naf[a].length, max);
          max = Math.max(naf[b].length, max);
          continue;
        }
        const comb = [
          points[a],
          null,
          null,
          points[b]
          /* 7 */
        ];
        if ((points[a].y ?? new BigNumber(0)).cmp(points[b].y ?? new BigNumber(0)) === 0) {
          comb[1] = points[a].add(points[b]);
          comb[2] = points[a].toJ().mixedAdd(points[b].neg());
        } else if ((points[a].y ?? new BigNumber(0)).cmp((points[b].y ?? new BigNumber(0)).redNeg()) === 0) {
          comb[1] = points[a].toJ().mixedAdd(points[b]);
          comb[2] = points[a].add(points[b].neg());
        } else {
          comb[1] = points[a].toJ().mixedAdd(points[b]);
          comb[2] = points[a].toJ().mixedAdd(points[b].neg());
        }
        const index = [
          -3,
          -1,
          -5,
          -7,
          0,
          7,
          5,
          1,
          3
          /* 1 1 */
        ];
        const jsf = this.curve.getJSF(coeffs[a], coeffs[b]);
        max = Math.max(jsf[0].length, max);
        naf[a] = new Array(max);
        naf[b] = new Array(max);
        for (let j = 0; j < max; j++) {
          const ja = Math.trunc(jsf[0][j]);
          const jb = Math.trunc(jsf[1][j]);
          naf[a][j] = index[(ja + 1) * 3 + (jb + 1)];
          naf[b][j] = 0;
          wnd[a] = comb;
        }
      }
      let acc = new JacobianPoint(null, null, null);
      const tmp = this.curve._wnafT4;
      for (let i = max; i >= 0; i--) {
        let k = 0;
        while (i >= 0) {
          let zero = true;
          for (let j = 0; j < len; j++) {
            tmp[j] = new BigNumber(typeof naf[j][i] === "number" ? naf[j][i] : 0);
            if (!tmp[j].isZero()) {
              zero = false;
            }
          }
          if (!zero) {
            break;
          }
          k++;
          i--;
        }
        if (i >= 0) {
          k++;
        }
        acc = acc.dblp(k);
        if (i < 0) {
          break;
        }
        const one = new BigNumber(1);
        const two = new BigNumber(2);
        for (let j = 0; j < len; j++) {
          const z = tmp[j];
          let p;
          if (z.cmpn(0) === 0) {
            continue;
          } else if (z.isNeg()) {
            p = wnd[j][z.neg().sub(one).div(two).toNumber()].neg();
          } else {
            p = wnd[j][z.sub(one).div(two).toNumber()];
          }
          if (p.type === "affine") {
            acc = acc.mixedAdd(p);
          } else {
            acc = acc.add(p);
          }
        }
      }
      for (let i = 0; i < len; i++) {
        wnd[i] = [];
      }
      if (jacobianResult === true) {
        return acc;
      } else {
        return acc.toP();
      }
    }
    _endoWnafMulAdd(points, coeffs, jacobianResult) {
      const npoints = new Array(points.length * 2);
      const ncoeffs = new Array(points.length * 2);
      let i;
      for (i = 0; i < points.length; i++) {
        const split2 = this.curve._endoSplit(coeffs[i]);
        let p = points[i];
        let beta = p._getBeta() ?? new _Point(null, null);
        if (split2.k1.negative !== 0) {
          split2.k1.ineg();
          p = p.neg(true);
        }
        if (split2.k2.negative !== 0) {
          split2.k2.ineg();
          beta = beta.neg(true);
        }
        npoints[i * 2] = p;
        npoints[i * 2 + 1] = beta;
        ncoeffs[i * 2] = split2.k1;
        ncoeffs[i * 2 + 1] = split2.k2;
      }
      const res = this._wnafMulAdd(1, npoints, ncoeffs, i * 2, jacobianResult);
      for (let j = 0; j < i * 2; j++) {
        npoints[j] = null;
        ncoeffs[j] = null;
      }
      return res;
    }
    _hasDoubles(k) {
      if (this.precomputed == null) {
        return false;
      }
      const doubles = this.precomputed.doubles;
      if (typeof doubles !== "object") {
        return false;
      }
      return doubles.points.length >= Math.ceil((k.bitLength() + 1) / doubles.step);
    }
    _getDoubles(step, power) {
      if (typeof this.precomputed === "object" && this.precomputed !== null && typeof this.precomputed.doubles === "object" && this.precomputed.doubles !== null) {
        return this.precomputed.doubles;
      }
      const doubles = [this];
      let acc = this;
      for (let i = 0; i < (power ?? 0); i += step ?? 1) {
        for (let j = 0; j < (step ?? 1); j++) {
          acc = acc.dbl();
        }
        doubles.push(acc);
      }
      return {
        step: step ?? 1,
        points: doubles
      };
    }
    _getNAFPoints(wnd) {
      if (typeof this.precomputed === "object" && this.precomputed !== null && typeof this.precomputed.naf === "object" && this.precomputed.naf !== null) {
        return this.precomputed.naf;
      }
      const res = [this];
      const max = (1 << wnd) - 1;
      const dbl = max === 1 ? null : this.dbl();
      for (let i = 1; i < max; i++) {
        if (dbl !== null) {
          res[i] = res[i - 1].add(dbl);
        }
      }
      return {
        wnd,
        points: res
      };
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/Curve.js
  var globalCurve;
  var Curve = class _Curve {
    constructor() {
      __publicField(this, "p");
      __publicField(this, "red");
      __publicField(this, "redN");
      __publicField(this, "zero");
      __publicField(this, "one");
      __publicField(this, "two");
      __publicField(this, "g");
      __publicField(this, "n");
      __publicField(this, "a");
      __publicField(this, "b");
      __publicField(this, "tinv");
      __publicField(this, "zeroA");
      __publicField(this, "threeA");
      __publicField(this, "endo");
      // beta, lambda, basis
      __publicField(this, "_endoWnafT1");
      __publicField(this, "_endoWnafT2");
      __publicField(this, "_wnafT1");
      __publicField(this, "_wnafT2");
      __publicField(this, "_wnafT3");
      __publicField(this, "_wnafT4");
      __publicField(this, "_bitLength");
      if (globalCurve === void 0) {
        globalCurve = this;
      } else {
        return globalCurve;
      }
      const precomputed = {
        doubles: {
          step: 4,
          points: [
            [
              "e60fce93b59e9ec53011aabc21c23e97b2a31369b87a5ae9c44ee89e2a6dec0a",
              "f7e3507399e595929db99f34f57937101296891e44d23f0be1f32cce69616821"
            ],
            [
              "8282263212c609d9ea2a6e3e172de238d8c39cabd5ac1ca10646e23fd5f51508",
              "11f8a8098557dfe45e8256e830b60ace62d613ac2f7b17bed31b6eaff6e26caf"
            ],
            [
              "175e159f728b865a72f99cc6c6fc846de0b93833fd2222ed73fce5b551e5b739",
              "d3506e0d9e3c79eba4ef97a51ff71f5eacb5955add24345c6efa6ffee9fed695"
            ],
            [
              "363d90d447b00c9c99ceac05b6262ee053441c7e55552ffe526bad8f83ff4640",
              "4e273adfc732221953b445397f3363145b9a89008199ecb62003c7f3bee9de9"
            ],
            [
              "8b4b5f165df3c2be8c6244b5b745638843e4a781a15bcd1b69f79a55dffdf80c",
              "4aad0a6f68d308b4b3fbd7813ab0da04f9e336546162ee56b3eff0c65fd4fd36"
            ],
            [
              "723cbaa6e5db996d6bf771c00bd548c7b700dbffa6c0e77bcb6115925232fcda",
              "96e867b5595cc498a921137488824d6e2660a0653779494801dc069d9eb39f5f"
            ],
            [
              "eebfa4d493bebf98ba5feec812c2d3b50947961237a919839a533eca0e7dd7fa",
              "5d9a8ca3970ef0f269ee7edaf178089d9ae4cdc3a711f712ddfd4fdae1de8999"
            ],
            [
              "100f44da696e71672791d0a09b7bde459f1215a29b3c03bfefd7835b39a48db0",
              "cdd9e13192a00b772ec8f3300c090666b7ff4a18ff5195ac0fbd5cd62bc65a09"
            ],
            [
              "e1031be262c7ed1b1dc9227a4a04c017a77f8d4464f3b3852c8acde6e534fd2d",
              "9d7061928940405e6bb6a4176597535af292dd419e1ced79a44f18f29456a00d"
            ],
            [
              "feea6cae46d55b530ac2839f143bd7ec5cf8b266a41d6af52d5e688d9094696d",
              "e57c6b6c97dce1bab06e4e12bf3ecd5c981c8957cc41442d3155debf18090088"
            ],
            [
              "da67a91d91049cdcb367be4be6ffca3cfeed657d808583de33fa978bc1ec6cb1",
              "9bacaa35481642bc41f463f7ec9780e5dec7adc508f740a17e9ea8e27a68be1d"
            ],
            [
              "53904faa0b334cdda6e000935ef22151ec08d0f7bb11069f57545ccc1a37b7c0",
              "5bc087d0bc80106d88c9eccac20d3c1c13999981e14434699dcb096b022771c8"
            ],
            [
              "8e7bcd0bd35983a7719cca7764ca906779b53a043a9b8bcaeff959f43ad86047",
              "10b7770b2a3da4b3940310420ca9514579e88e2e47fd68b3ea10047e8460372a"
            ],
            [
              "385eed34c1cdff21e6d0818689b81bde71a7f4f18397e6690a841e1599c43862",
              "283bebc3e8ea23f56701de19e9ebf4576b304eec2086dc8cc0458fe5542e5453"
            ],
            [
              "6f9d9b803ecf191637c73a4413dfa180fddf84a5947fbc9c606ed86c3fac3a7",
              "7c80c68e603059ba69b8e2a30e45c4d47ea4dd2f5c281002d86890603a842160"
            ],
            [
              "3322d401243c4e2582a2147c104d6ecbf774d163db0f5e5313b7e0e742d0e6bd",
              "56e70797e9664ef5bfb019bc4ddaf9b72805f63ea2873af624f3a2e96c28b2a0"
            ],
            [
              "85672c7d2de0b7da2bd1770d89665868741b3f9af7643397721d74d28134ab83",
              "7c481b9b5b43b2eb6374049bfa62c2e5e77f17fcc5298f44c8e3094f790313a6"
            ],
            [
              "948bf809b1988a46b06c9f1919413b10f9226c60f668832ffd959af60c82a0a",
              "53a562856dcb6646dc6b74c5d1c3418c6d4dff08c97cd2bed4cb7f88d8c8e589"
            ],
            [
              "6260ce7f461801c34f067ce0f02873a8f1b0e44dfc69752accecd819f38fd8e8",
              "bc2da82b6fa5b571a7f09049776a1ef7ecd292238051c198c1a84e95b2b4ae17"
            ],
            [
              "e5037de0afc1d8d43d8348414bbf4103043ec8f575bfdc432953cc8d2037fa2d",
              "4571534baa94d3b5f9f98d09fb990bddbd5f5b03ec481f10e0e5dc841d755bda"
            ],
            [
              "e06372b0f4a207adf5ea905e8f1771b4e7e8dbd1c6a6c5b725866a0ae4fce725",
              "7a908974bce18cfe12a27bb2ad5a488cd7484a7787104870b27034f94eee31dd"
            ],
            [
              "213c7a715cd5d45358d0bbf9dc0ce02204b10bdde2a3f58540ad6908d0559754",
              "4b6dad0b5ae462507013ad06245ba190bb4850f5f36a7eeddff2c27534b458f2"
            ],
            [
              "4e7c272a7af4b34e8dbb9352a5419a87e2838c70adc62cddf0cc3a3b08fbd53c",
              "17749c766c9d0b18e16fd09f6def681b530b9614bff7dd33e0b3941817dcaae6"
            ],
            [
              "fea74e3dbe778b1b10f238ad61686aa5c76e3db2be43057632427e2840fb27b6",
              "6e0568db9b0b13297cf674deccb6af93126b596b973f7b77701d3db7f23cb96f"
            ],
            [
              "76e64113f677cf0e10a2570d599968d31544e179b760432952c02a4417bdde39",
              "c90ddf8dee4e95cf577066d70681f0d35e2a33d2b56d2032b4b1752d1901ac01"
            ],
            [
              "c738c56b03b2abe1e8281baa743f8f9a8f7cc643df26cbee3ab150242bcbb891",
              "893fb578951ad2537f718f2eacbfbbbb82314eef7880cfe917e735d9699a84c3"
            ],
            [
              "d895626548b65b81e264c7637c972877d1d72e5f3a925014372e9f6588f6c14b",
              "febfaa38f2bc7eae728ec60818c340eb03428d632bb067e179363ed75d7d991f"
            ],
            [
              "b8da94032a957518eb0f6433571e8761ceffc73693e84edd49150a564f676e03",
              "2804dfa44805a1e4d7c99cc9762808b092cc584d95ff3b511488e4e74efdf6e7"
            ],
            [
              "e80fea14441fb33a7d8adab9475d7fab2019effb5156a792f1a11778e3c0df5d",
              "eed1de7f638e00771e89768ca3ca94472d155e80af322ea9fcb4291b6ac9ec78"
            ],
            [
              "a301697bdfcd704313ba48e51d567543f2a182031efd6915ddc07bbcc4e16070",
              "7370f91cfb67e4f5081809fa25d40f9b1735dbf7c0a11a130c0d1a041e177ea1"
            ],
            [
              "90ad85b389d6b936463f9d0512678de208cc330b11307fffab7ac63e3fb04ed4",
              "e507a3620a38261affdcbd9427222b839aefabe1582894d991d4d48cb6ef150"
            ],
            [
              "8f68b9d2f63b5f339239c1ad981f162ee88c5678723ea3351b7b444c9ec4c0da",
              "662a9f2dba063986de1d90c2b6be215dbbea2cfe95510bfdf23cbf79501fff82"
            ],
            [
              "e4f3fb0176af85d65ff99ff9198c36091f48e86503681e3e6686fd5053231e11",
              "1e63633ad0ef4f1c1661a6d0ea02b7286cc7e74ec951d1c9822c38576feb73bc"
            ],
            [
              "8c00fa9b18ebf331eb961537a45a4266c7034f2f0d4e1d0716fb6eae20eae29e",
              "efa47267fea521a1a9dc343a3736c974c2fadafa81e36c54e7d2a4c66702414b"
            ],
            [
              "e7a26ce69dd4829f3e10cec0a9e98ed3143d084f308b92c0997fddfc60cb3e41",
              "2a758e300fa7984b471b006a1aafbb18d0a6b2c0420e83e20e8a9421cf2cfd51"
            ],
            [
              "b6459e0ee3662ec8d23540c223bcbdc571cbcb967d79424f3cf29eb3de6b80ef",
              "67c876d06f3e06de1dadf16e5661db3c4b3ae6d48e35b2ff30bf0b61a71ba45"
            ],
            [
              "d68a80c8280bb840793234aa118f06231d6f1fc67e73c5a5deda0f5b496943e8",
              "db8ba9fff4b586d00c4b1f9177b0e28b5b0e7b8f7845295a294c84266b133120"
            ],
            [
              "324aed7df65c804252dc0270907a30b09612aeb973449cea4095980fc28d3d5d",
              "648a365774b61f2ff130c0c35aec1f4f19213b0c7e332843967224af96ab7c84"
            ],
            [
              "4df9c14919cde61f6d51dfdbe5fee5dceec4143ba8d1ca888e8bd373fd054c96",
              "35ec51092d8728050974c23a1d85d4b5d506cdc288490192ebac06cad10d5d"
            ],
            [
              "9c3919a84a474870faed8a9c1cc66021523489054d7f0308cbfc99c8ac1f98cd",
              "ddb84f0f4a4ddd57584f044bf260e641905326f76c64c8e6be7e5e03d4fc599d"
            ],
            [
              "6057170b1dd12fdf8de05f281d8e06bb91e1493a8b91d4cc5a21382120a959e5",
              "9a1af0b26a6a4807add9a2daf71df262465152bc3ee24c65e899be932385a2a8"
            ],
            [
              "a576df8e23a08411421439a4518da31880cef0fba7d4df12b1a6973eecb94266",
              "40a6bf20e76640b2c92b97afe58cd82c432e10a7f514d9f3ee8be11ae1b28ec8"
            ],
            [
              "7778a78c28dec3e30a05fe9629de8c38bb30d1f5cf9a3a208f763889be58ad71",
              "34626d9ab5a5b22ff7098e12f2ff580087b38411ff24ac563b513fc1fd9f43ac"
            ],
            [
              "928955ee637a84463729fd30e7afd2ed5f96274e5ad7e5cb09eda9c06d903ac",
              "c25621003d3f42a827b78a13093a95eeac3d26efa8a8d83fc5180e935bcd091f"
            ],
            [
              "85d0fef3ec6db109399064f3a0e3b2855645b4a907ad354527aae75163d82751",
              "1f03648413a38c0be29d496e582cf5663e8751e96877331582c237a24eb1f962"
            ],
            [
              "ff2b0dce97eece97c1c9b6041798b85dfdfb6d8882da20308f5404824526087e",
              "493d13fef524ba188af4c4dc54d07936c7b7ed6fb90e2ceb2c951e01f0c29907"
            ],
            [
              "827fbbe4b1e880ea9ed2b2e6301b212b57f1ee148cd6dd28780e5e2cf856e241",
              "c60f9c923c727b0b71bef2c67d1d12687ff7a63186903166d605b68baec293ec"
            ],
            [
              "eaa649f21f51bdbae7be4ae34ce6e5217a58fdce7f47f9aa7f3b58fa2120e2b3",
              "be3279ed5bbbb03ac69a80f89879aa5a01a6b965f13f7e59d47a5305ba5ad93d"
            ],
            [
              "e4a42d43c5cf169d9391df6decf42ee541b6d8f0c9a137401e23632dda34d24f",
              "4d9f92e716d1c73526fc99ccfb8ad34ce886eedfa8d8e4f13a7f7131deba9414"
            ],
            [
              "1ec80fef360cbdd954160fadab352b6b92b53576a88fea4947173b9d4300bf19",
              "aeefe93756b5340d2f3a4958a7abbf5e0146e77f6295a07b671cdc1cc107cefd"
            ],
            [
              "146a778c04670c2f91b00af4680dfa8bce3490717d58ba889ddb5928366642be",
              "b318e0ec3354028add669827f9d4b2870aaa971d2f7e5ed1d0b297483d83efd0"
            ],
            [
              "fa50c0f61d22e5f07e3acebb1aa07b128d0012209a28b9776d76a8793180eef9",
              "6b84c6922397eba9b72cd2872281a68a5e683293a57a213b38cd8d7d3f4f2811"
            ],
            [
              "da1d61d0ca721a11b1a5bf6b7d88e8421a288ab5d5bba5220e53d32b5f067ec2",
              "8157f55a7c99306c79c0766161c91e2966a73899d279b48a655fba0f1ad836f1"
            ],
            [
              "a8e282ff0c9706907215ff98e8fd416615311de0446f1e062a73b0610d064e13",
              "7f97355b8db81c09abfb7f3c5b2515888b679a3e50dd6bd6cef7c73111f4cc0c"
            ],
            [
              "174a53b9c9a285872d39e56e6913cab15d59b1fa512508c022f382de8319497c",
              "ccc9dc37abfc9c1657b4155f2c47f9e6646b3a1d8cb9854383da13ac079afa73"
            ],
            [
              "959396981943785c3d3e57edf5018cdbe039e730e4918b3d884fdff09475b7ba",
              "2e7e552888c331dd8ba0386a4b9cd6849c653f64c8709385e9b8abf87524f2fd"
            ],
            [
              "d2a63a50ae401e56d645a1153b109a8fcca0a43d561fba2dbb51340c9d82b151",
              "e82d86fb6443fcb7565aee58b2948220a70f750af484ca52d4142174dcf89405"
            ],
            [
              "64587e2335471eb890ee7896d7cfdc866bacbdbd3839317b3436f9b45617e073",
              "d99fcdd5bf6902e2ae96dd6447c299a185b90a39133aeab358299e5e9faf6589"
            ],
            [
              "8481bde0e4e4d885b3a546d3e549de042f0aa6cea250e7fd358d6c86dd45e458",
              "38ee7b8cba5404dd84a25bf39cecb2ca900a79c42b262e556d64b1b59779057e"
            ],
            [
              "13464a57a78102aa62b6979ae817f4637ffcfed3c4b1ce30bcd6303f6caf666b",
              "69be159004614580ef7e433453ccb0ca48f300a81d0942e13f495a907f6ecc27"
            ],
            [
              "bc4a9df5b713fe2e9aef430bcc1dc97a0cd9ccede2f28588cada3a0d2d83f366",
              "d3a81ca6e785c06383937adf4b798caa6e8a9fbfa547b16d758d666581f33c1"
            ],
            [
              "8c28a97bf8298bc0d23d8c749452a32e694b65e30a9472a3954ab30fe5324caa",
              "40a30463a3305193378fedf31f7cc0eb7ae784f0451cb9459e71dc73cbef9482"
            ],
            [
              "8ea9666139527a8c1dd94ce4f071fd23c8b350c5a4bb33748c4ba111faccae0",
              "620efabbc8ee2782e24e7c0cfb95c5d735b783be9cf0f8e955af34a30e62b945"
            ],
            [
              "dd3625faef5ba06074669716bbd3788d89bdde815959968092f76cc4eb9a9787",
              "7a188fa3520e30d461da2501045731ca941461982883395937f68d00c644a573"
            ],
            [
              "f710d79d9eb962297e4f6232b40e8f7feb2bc63814614d692c12de752408221e",
              "ea98e67232d3b3295d3b535532115ccac8612c721851617526ae47a9c77bfc82"
            ]
          ]
        },
        naf: {
          wnd: 7,
          points: [
            [
              "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9",
              "388f7b0f632de8140fe337e62a37f3566500a99934c2231b6cb9fd7584b8e672"
            ],
            [
              "2f8bde4d1a07209355b4a7250a5c5128e88b84bddc619ab7cba8d569b240efe4",
              "d8ac222636e5e3d6d4dba9dda6c9c426f788271bab0d6840dca87d3aa6ac62d6"
            ],
            [
              "5cbdf0646e5db4eaa398f365f2ea7a0e3d419b7e0330e39ce92bddedcac4f9bc",
              "6aebca40ba255960a3178d6d861a54dba813d0b813fde7b5a5082628087264da"
            ],
            [
              "acd484e2f0c7f65309ad178a9f559abde09796974c57e714c35f110dfc27ccbe",
              "cc338921b0a7d9fd64380971763b61e9add888a4375f8e0f05cc262ac64f9c37"
            ],
            [
              "774ae7f858a9411e5ef4246b70c65aac5649980be5c17891bbec17895da008cb",
              "d984a032eb6b5e190243dd56d7b7b365372db1e2dff9d6a8301d74c9c953c61b"
            ],
            [
              "f28773c2d975288bc7d1d205c3748651b075fbc6610e58cddeeddf8f19405aa8",
              "ab0902e8d880a89758212eb65cdaf473a1a06da521fa91f29b5cb52db03ed81"
            ],
            [
              "d7924d4f7d43ea965a465ae3095ff41131e5946f3c85f79e44adbcf8e27e080e",
              "581e2872a86c72a683842ec228cc6defea40af2bd896d3a5c504dc9ff6a26b58"
            ],
            [
              "defdea4cdb677750a420fee807eacf21eb9898ae79b9768766e4faa04a2d4a34",
              "4211ab0694635168e997b0ead2a93daeced1f4a04a95c0f6cfb199f69e56eb77"
            ],
            [
              "2b4ea0a797a443d293ef5cff444f4979f06acfebd7e86d277475656138385b6c",
              "85e89bc037945d93b343083b5a1c86131a01f60c50269763b570c854e5c09b7a"
            ],
            [
              "352bbf4a4cdd12564f93fa332ce333301d9ad40271f8107181340aef25be59d5",
              "321eb4075348f534d59c18259dda3e1f4a1b3b2e71b1039c67bd3d8bcf81998c"
            ],
            [
              "2fa2104d6b38d11b0230010559879124e42ab8dfeff5ff29dc9cdadd4ecacc3f",
              "2de1068295dd865b64569335bd5dd80181d70ecfc882648423ba76b532b7d67"
            ],
            [
              "9248279b09b4d68dab21a9b066edda83263c3d84e09572e269ca0cd7f5453714",
              "73016f7bf234aade5d1aa71bdea2b1ff3fc0de2a887912ffe54a32ce97cb3402"
            ],
            [
              "daed4f2be3a8bf278e70132fb0beb7522f570e144bf615c07e996d443dee8729",
              "a69dce4a7d6c98e8d4a1aca87ef8d7003f83c230f3afa726ab40e52290be1c55"
            ],
            [
              "c44d12c7065d812e8acf28d7cbb19f9011ecd9e9fdf281b0e6a3b5e87d22e7db",
              "2119a460ce326cdc76c45926c982fdac0e106e861edf61c5a039063f0e0e6482"
            ],
            [
              "6a245bf6dc698504c89a20cfded60853152b695336c28063b61c65cbd269e6b4",
              "e022cf42c2bd4a708b3f5126f16a24ad8b33ba48d0423b6efd5e6348100d8a82"
            ],
            [
              "1697ffa6fd9de627c077e3d2fe541084ce13300b0bec1146f95ae57f0d0bd6a5",
              "b9c398f186806f5d27561506e4557433a2cf15009e498ae7adee9d63d01b2396"
            ],
            [
              "605bdb019981718b986d0f07e834cb0d9deb8360ffb7f61df982345ef27a7479",
              "2972d2de4f8d20681a78d93ec96fe23c26bfae84fb14db43b01e1e9056b8c49"
            ],
            [
              "62d14dab4150bf497402fdc45a215e10dcb01c354959b10cfe31c7e9d87ff33d",
              "80fc06bd8cc5b01098088a1950eed0db01aa132967ab472235f5642483b25eaf"
            ],
            [
              "80c60ad0040f27dade5b4b06c408e56b2c50e9f56b9b8b425e555c2f86308b6f",
              "1c38303f1cc5c30f26e66bad7fe72f70a65eed4cbe7024eb1aa01f56430bd57a"
            ],
            [
              "7a9375ad6167ad54aa74c6348cc54d344cc5dc9487d847049d5eabb0fa03c8fb",
              "d0e3fa9eca8726909559e0d79269046bdc59ea10c70ce2b02d499ec224dc7f7"
            ],
            [
              "d528ecd9b696b54c907a9ed045447a79bb408ec39b68df504bb51f459bc3ffc9",
              "eecf41253136e5f99966f21881fd656ebc4345405c520dbc063465b521409933"
            ],
            [
              "49370a4b5f43412ea25f514e8ecdad05266115e4a7ecb1387231808f8b45963",
              "758f3f41afd6ed428b3081b0512fd62a54c3f3afbb5b6764b653052a12949c9a"
            ],
            [
              "77f230936ee88cbbd73df930d64702ef881d811e0e1498e2f1c13eb1fc345d74",
              "958ef42a7886b6400a08266e9ba1b37896c95330d97077cbbe8eb3c7671c60d6"
            ],
            [
              "f2dac991cc4ce4b9ea44887e5c7c0bce58c80074ab9d4dbaeb28531b7739f530",
              "e0dedc9b3b2f8dad4da1f32dec2531df9eb5fbeb0598e4fd1a117dba703a3c37"
            ],
            [
              "463b3d9f662621fb1b4be8fbbe2520125a216cdfc9dae3debcba4850c690d45b",
              "5ed430d78c296c3543114306dd8622d7c622e27c970a1de31cb377b01af7307e"
            ],
            [
              "f16f804244e46e2a09232d4aff3b59976b98fac14328a2d1a32496b49998f247",
              "cedabd9b82203f7e13d206fcdf4e33d92a6c53c26e5cce26d6579962c4e31df6"
            ],
            [
              "caf754272dc84563b0352b7a14311af55d245315ace27c65369e15f7151d41d1",
              "cb474660ef35f5f2a41b643fa5e460575f4fa9b7962232a5c32f908318a04476"
            ],
            [
              "2600ca4b282cb986f85d0f1709979d8b44a09c07cb86d7c124497bc86f082120",
              "4119b88753c15bd6a693b03fcddbb45d5ac6be74ab5f0ef44b0be9475a7e4b40"
            ],
            [
              "7635ca72d7e8432c338ec53cd12220bc01c48685e24f7dc8c602a7746998e435",
              "91b649609489d613d1d5e590f78e6d74ecfc061d57048bad9e76f302c5b9c61"
            ],
            [
              "754e3239f325570cdbbf4a87deee8a66b7f2b33479d468fbc1a50743bf56cc18",
              "673fb86e5bda30fb3cd0ed304ea49a023ee33d0197a695d0c5d98093c536683"
            ],
            [
              "e3e6bd1071a1e96aff57859c82d570f0330800661d1c952f9fe2694691d9b9e8",
              "59c9e0bba394e76f40c0aa58379a3cb6a5a2283993e90c4167002af4920e37f5"
            ],
            [
              "186b483d056a033826ae73d88f732985c4ccb1f32ba35f4b4cc47fdcf04aa6eb",
              "3b952d32c67cf77e2e17446e204180ab21fb8090895138b4a4a797f86e80888b"
            ],
            [
              "df9d70a6b9876ce544c98561f4be4f725442e6d2b737d9c91a8321724ce0963f",
              "55eb2dafd84d6ccd5f862b785dc39d4ab157222720ef9da217b8c45cf2ba2417"
            ],
            [
              "5edd5cc23c51e87a497ca815d5dce0f8ab52554f849ed8995de64c5f34ce7143",
              "efae9c8dbc14130661e8cec030c89ad0c13c66c0d17a2905cdc706ab7399a868"
            ],
            [
              "290798c2b6476830da12fe02287e9e777aa3fba1c355b17a722d362f84614fba",
              "e38da76dcd440621988d00bcf79af25d5b29c094db2a23146d003afd41943e7a"
            ],
            [
              "af3c423a95d9f5b3054754efa150ac39cd29552fe360257362dfdecef4053b45",
              "f98a3fd831eb2b749a93b0e6f35cfb40c8cd5aa667a15581bc2feded498fd9c6"
            ],
            [
              "766dbb24d134e745cccaa28c99bf274906bb66b26dcf98df8d2fed50d884249a",
              "744b1152eacbe5e38dcc887980da38b897584a65fa06cedd2c924f97cbac5996"
            ],
            [
              "59dbf46f8c94759ba21277c33784f41645f7b44f6c596a58ce92e666191abe3e",
              "c534ad44175fbc300f4ea6ce648309a042ce739a7919798cd85e216c4a307f6e"
            ],
            [
              "f13ada95103c4537305e691e74e9a4a8dd647e711a95e73cb62dc6018cfd87b8",
              "e13817b44ee14de663bf4bc808341f326949e21a6a75c2570778419bdaf5733d"
            ],
            [
              "7754b4fa0e8aced06d4167a2c59cca4cda1869c06ebadfb6488550015a88522c",
              "30e93e864e669d82224b967c3020b8fa8d1e4e350b6cbcc537a48b57841163a2"
            ],
            [
              "948dcadf5990e048aa3874d46abef9d701858f95de8041d2a6828c99e2262519",
              "e491a42537f6e597d5d28a3224b1bc25df9154efbd2ef1d2cbba2cae5347d57e"
            ],
            [
              "7962414450c76c1689c7b48f8202ec37fb224cf5ac0bfa1570328a8a3d7c77ab",
              "100b610ec4ffb4760d5c1fc133ef6f6b12507a051f04ac5760afa5b29db83437"
            ],
            [
              "3514087834964b54b15b160644d915485a16977225b8847bb0dd085137ec47ca",
              "ef0afbb2056205448e1652c48e8127fc6039e77c15c2378b7e7d15a0de293311"
            ],
            [
              "d3cc30ad6b483e4bc79ce2c9dd8bc54993e947eb8df787b442943d3f7b527eaf",
              "8b378a22d827278d89c5e9be8f9508ae3c2ad46290358630afb34db04eede0a4"
            ],
            [
              "1624d84780732860ce1c78fcbfefe08b2b29823db913f6493975ba0ff4847610",
              "68651cf9b6da903e0914448c6cd9d4ca896878f5282be4c8cc06e2a404078575"
            ],
            [
              "733ce80da955a8a26902c95633e62a985192474b5af207da6df7b4fd5fc61cd4",
              "f5435a2bd2badf7d485a4d8b8db9fcce3e1ef8e0201e4578c54673bc1dc5ea1d"
            ],
            [
              "15d9441254945064cf1a1c33bbd3b49f8966c5092171e699ef258dfab81c045c",
              "d56eb30b69463e7234f5137b73b84177434800bacebfc685fc37bbe9efe4070d"
            ],
            [
              "a1d0fcf2ec9de675b612136e5ce70d271c21417c9d2b8aaaac138599d0717940",
              "edd77f50bcb5a3cab2e90737309667f2641462a54070f3d519212d39c197a629"
            ],
            [
              "e22fbe15c0af8ccc5780c0735f84dbe9a790badee8245c06c7ca37331cb36980",
              "a855babad5cd60c88b430a69f53a1a7a38289154964799be43d06d77d31da06"
            ],
            [
              "311091dd9860e8e20ee13473c1155f5f69635e394704eaa74009452246cfa9b3",
              "66db656f87d1f04fffd1f04788c06830871ec5a64feee685bd80f0b1286d8374"
            ],
            [
              "34c1fd04d301be89b31c0442d3e6ac24883928b45a9340781867d4232ec2dbdf",
              "9414685e97b1b5954bd46f730174136d57f1ceeb487443dc5321857ba73abee"
            ],
            [
              "f219ea5d6b54701c1c14de5b557eb42a8d13f3abbcd08affcc2a5e6b049b8d63",
              "4cb95957e83d40b0f73af4544cccf6b1f4b08d3c07b27fb8d8c2962a400766d1"
            ],
            [
              "d7b8740f74a8fbaab1f683db8f45de26543a5490bca627087236912469a0b448",
              "fa77968128d9c92ee1010f337ad4717eff15db5ed3c049b3411e0315eaa4593b"
            ],
            [
              "32d31c222f8f6f0ef86f7c98d3a3335ead5bcd32abdd94289fe4d3091aa824bf",
              "5f3032f5892156e39ccd3d7915b9e1da2e6dac9e6f26e961118d14b8462e1661"
            ],
            [
              "7461f371914ab32671045a155d9831ea8793d77cd59592c4340f86cbc18347b5",
              "8ec0ba238b96bec0cbdddcae0aa442542eee1ff50c986ea6b39847b3cc092ff6"
            ],
            [
              "ee079adb1df1860074356a25aa38206a6d716b2c3e67453d287698bad7b2b2d6",
              "8dc2412aafe3be5c4c5f37e0ecc5f9f6a446989af04c4e25ebaac479ec1c8c1e"
            ],
            [
              "16ec93e447ec83f0467b18302ee620f7e65de331874c9dc72bfd8616ba9da6b5",
              "5e4631150e62fb40d0e8c2a7ca5804a39d58186a50e497139626778e25b0674d"
            ],
            [
              "eaa5f980c245f6f038978290afa70b6bd8855897f98b6aa485b96065d537bd99",
              "f65f5d3e292c2e0819a528391c994624d784869d7e6ea67fb18041024edc07dc"
            ],
            [
              "78c9407544ac132692ee1910a02439958ae04877151342ea96c4b6b35a49f51",
              "f3e0319169eb9b85d5404795539a5e68fa1fbd583c064d2462b675f194a3ddb4"
            ],
            [
              "494f4be219a1a77016dcd838431aea0001cdc8ae7a6fc688726578d9702857a5",
              "42242a969283a5f339ba7f075e36ba2af925ce30d767ed6e55f4b031880d562c"
            ],
            [
              "a598a8030da6d86c6bc7f2f5144ea549d28211ea58faa70ebf4c1e665c1fe9b5",
              "204b5d6f84822c307e4b4a7140737aec23fc63b65b35f86a10026dbd2d864e6b"
            ],
            [
              "c41916365abb2b5d09192f5f2dbeafec208f020f12570a184dbadc3e58595997",
              "4f14351d0087efa49d245b328984989d5caf9450f34bfc0ed16e96b58fa9913"
            ],
            [
              "841d6063a586fa475a724604da03bc5b92a2e0d2e0a36acfe4c73a5514742881",
              "73867f59c0659e81904f9a1c7543698e62562d6744c169ce7a36de01a8d6154"
            ],
            [
              "5e95bb399a6971d376026947f89bde2f282b33810928be4ded112ac4d70e20d5",
              "39f23f366809085beebfc71181313775a99c9aed7d8ba38b161384c746012865"
            ],
            [
              "36e4641a53948fd476c39f8a99fd974e5ec07564b5315d8bf99471bca0ef2f66",
              "d2424b1b1abe4eb8164227b085c9aa9456ea13493fd563e06fd51cf5694c78fc"
            ],
            [
              "336581ea7bfbbb290c191a2f507a41cf5643842170e914faeab27c2c579f726",
              "ead12168595fe1be99252129b6e56b3391f7ab1410cd1e0ef3dcdcabd2fda224"
            ],
            [
              "8ab89816dadfd6b6a1f2634fcf00ec8403781025ed6890c4849742706bd43ede",
              "6fdcef09f2f6d0a044e654aef624136f503d459c3e89845858a47a9129cdd24e"
            ],
            [
              "1e33f1a746c9c5778133344d9299fcaa20b0938e8acff2544bb40284b8c5fb94",
              "60660257dd11b3aa9c8ed618d24edff2306d320f1d03010e33a7d2057f3b3b6"
            ],
            [
              "85b7c1dcb3cec1b7ee7f30ded79dd20a0ed1f4cc18cbcfcfa410361fd8f08f31",
              "3d98a9cdd026dd43f39048f25a8847f4fcafad1895d7a633c6fed3c35e999511"
            ],
            [
              "29df9fbd8d9e46509275f4b125d6d45d7fbe9a3b878a7af872a2800661ac5f51",
              "b4c4fe99c775a606e2d8862179139ffda61dc861c019e55cd2876eb2a27d84b"
            ],
            [
              "a0b1cae06b0a847a3fea6e671aaf8adfdfe58ca2f768105c8082b2e449fce252",
              "ae434102edde0958ec4b19d917a6a28e6b72da1834aff0e650f049503a296cf2"
            ],
            [
              "4e8ceafb9b3e9a136dc7ff67e840295b499dfb3b2133e4ba113f2e4c0e121e5",
              "cf2174118c8b6d7a4b48f6d534ce5c79422c086a63460502b827ce62a326683c"
            ],
            [
              "d24a44e047e19b6f5afb81c7ca2f69080a5076689a010919f42725c2b789a33b",
              "6fb8d5591b466f8fc63db50f1c0f1c69013f996887b8244d2cdec417afea8fa3"
            ],
            [
              "ea01606a7a6c9cdd249fdfcfacb99584001edd28abbab77b5104e98e8e3b35d4",
              "322af4908c7312b0cfbfe369f7a7b3cdb7d4494bc2823700cfd652188a3ea98d"
            ],
            [
              "af8addbf2b661c8a6c6328655eb96651252007d8c5ea31be4ad196de8ce2131f",
              "6749e67c029b85f52a034eafd096836b2520818680e26ac8f3dfbcdb71749700"
            ],
            [
              "e3ae1974566ca06cc516d47e0fb165a674a3dabcfca15e722f0e3450f45889",
              "2aeabe7e4531510116217f07bf4d07300de97e4874f81f533420a72eeb0bd6a4"
            ],
            [
              "591ee355313d99721cf6993ffed1e3e301993ff3ed258802075ea8ced397e246",
              "b0ea558a113c30bea60fc4775460c7901ff0b053d25ca2bdeee98f1a4be5d196"
            ],
            [
              "11396d55fda54c49f19aa97318d8da61fa8584e47b084945077cf03255b52984",
              "998c74a8cd45ac01289d5833a7beb4744ff536b01b257be4c5767bea93ea57a4"
            ],
            [
              "3c5d2a1ba39c5a1790000738c9e0c40b8dcdfd5468754b6405540157e017aa7a",
              "b2284279995a34e2f9d4de7396fc18b80f9b8b9fdd270f6661f79ca4c81bd257"
            ],
            [
              "cc8704b8a60a0defa3a99a7299f2e9c3fbc395afb04ac078425ef8a1793cc030",
              "bdd46039feed17881d1e0862db347f8cf395b74fc4bcdc4e940b74e3ac1f1b13"
            ],
            [
              "c533e4f7ea8555aacd9777ac5cad29b97dd4defccc53ee7ea204119b2889b197",
              "6f0a256bc5efdf429a2fb6242f1a43a2d9b925bb4a4b3a26bb8e0f45eb596096"
            ],
            [
              "c14f8f2ccb27d6f109f6d08d03cc96a69ba8c34eec07bbcf566d48e33da6593",
              "c359d6923bb398f7fd4473e16fe1c28475b740dd098075e6c0e8649113dc3a38"
            ],
            [
              "a6cbc3046bc6a450bac24789fa17115a4c9739ed75f8f21ce441f72e0b90e6ef",
              "21ae7f4680e889bb130619e2c0f95a360ceb573c70603139862afd617fa9b9f"
            ],
            [
              "347d6d9a02c48927ebfb86c1359b1caf130a3c0267d11ce6344b39f99d43cc38",
              "60ea7f61a353524d1c987f6ecec92f086d565ab687870cb12689ff1e31c74448"
            ],
            [
              "da6545d2181db8d983f7dcb375ef5866d47c67b1bf31c8cf855ef7437b72656a",
              "49b96715ab6878a79e78f07ce5680c5d6673051b4935bd897fea824b77dc208a"
            ],
            [
              "c40747cc9d012cb1a13b8148309c6de7ec25d6945d657146b9d5994b8feb1111",
              "5ca560753be2a12fc6de6caf2cb489565db936156b9514e1bb5e83037e0fa2d4"
            ],
            [
              "4e42c8ec82c99798ccf3a610be870e78338c7f713348bd34c8203ef4037f3502",
              "7571d74ee5e0fb92a7a8b33a07783341a5492144cc54bcc40a94473693606437"
            ],
            [
              "3775ab7089bc6af823aba2e1af70b236d251cadb0c86743287522a1b3b0dedea",
              "be52d107bcfa09d8bcb9736a828cfa7fac8db17bf7a76a2c42ad961409018cf7"
            ],
            [
              "cee31cbf7e34ec379d94fb814d3d775ad954595d1314ba8846959e3e82f74e26",
              "8fd64a14c06b589c26b947ae2bcf6bfa0149ef0be14ed4d80f448a01c43b1c6d"
            ],
            [
              "b4f9eaea09b6917619f6ea6a4eb5464efddb58fd45b1ebefcdc1a01d08b47986",
              "39e5c9925b5a54b07433a4f18c61726f8bb131c012ca542eb24a8ac07200682a"
            ],
            [
              "d4263dfc3d2df923a0179a48966d30ce84e2515afc3dccc1b77907792ebcc60e",
              "62dfaf07a0f78feb30e30d6295853ce189e127760ad6cf7fae164e122a208d54"
            ],
            [
              "48457524820fa65a4f8d35eb6930857c0032acc0a4a2de422233eeda897612c4",
              "25a748ab367979d98733c38a1fa1c2e7dc6cc07db2d60a9ae7a76aaa49bd0f77"
            ],
            [
              "dfeeef1881101f2cb11644f3a2afdfc2045e19919152923f367a1767c11cceda",
              "ecfb7056cf1de042f9420bab396793c0c390bde74b4bbdff16a83ae09a9a7517"
            ],
            [
              "6d7ef6b17543f8373c573f44e1f389835d89bcbc6062ced36c82df83b8fae859",
              "cd450ec335438986dfefa10c57fea9bcc521a0959b2d80bbf74b190dca712d10"
            ],
            [
              "e75605d59102a5a2684500d3b991f2e3f3c88b93225547035af25af66e04541f",
              "f5c54754a8f71ee540b9b48728473e314f729ac5308b06938360990e2bfad125"
            ],
            [
              "eb98660f4c4dfaa06a2be453d5020bc99a0c2e60abe388457dd43fefb1ed620c",
              "6cb9a8876d9cb8520609af3add26cd20a0a7cd8a9411131ce85f44100099223e"
            ],
            [
              "13e87b027d8514d35939f2e6892b19922154596941888336dc3563e3b8dba942",
              "fef5a3c68059a6dec5d624114bf1e91aac2b9da568d6abeb2570d55646b8adf1"
            ],
            [
              "ee163026e9fd6fe017c38f06a5be6fc125424b371ce2708e7bf4491691e5764a",
              "1acb250f255dd61c43d94ccc670d0f58f49ae3fa15b96623e5430da0ad6c62b2"
            ],
            [
              "b268f5ef9ad51e4d78de3a750c2dc89b1e626d43505867999932e5db33af3d80",
              "5f310d4b3c99b9ebb19f77d41c1dee018cf0d34fd4191614003e945a1216e423"
            ],
            [
              "ff07f3118a9df035e9fad85eb6c7bfe42b02f01ca99ceea3bf7ffdba93c4750d",
              "438136d603e858a3a5c440c38eccbaddc1d2942114e2eddd4740d098ced1f0d8"
            ],
            [
              "8d8b9855c7c052a34146fd20ffb658bea4b9f69e0d825ebec16e8c3ce2b526a1",
              "cdb559eedc2d79f926baf44fb84ea4d44bcf50fee51d7ceb30e2e7f463036758"
            ],
            [
              "52db0b5384dfbf05bfa9d472d7ae26dfe4b851ceca91b1eba54263180da32b63",
              "c3b997d050ee5d423ebaf66a6db9f57b3180c902875679de924b69d84a7b375"
            ],
            [
              "e62f9490d3d51da6395efd24e80919cc7d0f29c3f3fa48c6fff543becbd43352",
              "6d89ad7ba4876b0b22c2ca280c682862f342c8591f1daf5170e07bfd9ccafa7d"
            ],
            [
              "7f30ea2476b399b4957509c88f77d0191afa2ff5cb7b14fd6d8e7d65aaab1193",
              "ca5ef7d4b231c94c3b15389a5f6311e9daff7bb67b103e9880ef4bff637acaec"
            ],
            [
              "5098ff1e1d9f14fb46a210fada6c903fef0fb7b4a1dd1d9ac60a0361800b7a00",
              "9731141d81fc8f8084d37c6e7542006b3ee1b40d60dfe5362a5b132fd17ddc0"
            ],
            [
              "32b78c7de9ee512a72895be6b9cbefa6e2f3c4ccce445c96b9f2c81e2778ad58",
              "ee1849f513df71e32efc3896ee28260c73bb80547ae2275ba497237794c8753c"
            ],
            [
              "e2cb74fddc8e9fbcd076eef2a7c72b0ce37d50f08269dfc074b581550547a4f7",
              "d3aa2ed71c9dd2247a62df062736eb0baddea9e36122d2be8641abcb005cc4a4"
            ],
            [
              "8438447566d4d7bedadc299496ab357426009a35f235cb141be0d99cd10ae3a8",
              "c4e1020916980a4da5d01ac5e6ad330734ef0d7906631c4f2390426b2edd791f"
            ],
            [
              "4162d488b89402039b584c6fc6c308870587d9c46f660b878ab65c82c711d67e",
              "67163e903236289f776f22c25fb8a3afc1732f2b84b4e95dbda47ae5a0852649"
            ],
            [
              "3fad3fa84caf0f34f0f89bfd2dcf54fc175d767aec3e50684f3ba4a4bf5f683d",
              "cd1bc7cb6cc407bb2f0ca647c718a730cf71872e7d0d2a53fa20efcdfe61826"
            ],
            [
              "674f2600a3007a00568c1a7ce05d0816c1fb84bf1370798f1c69532faeb1a86b",
              "299d21f9413f33b3edf43b257004580b70db57da0b182259e09eecc69e0d38a5"
            ],
            [
              "d32f4da54ade74abb81b815ad1fb3b263d82d6c692714bcff87d29bd5ee9f08f",
              "f9429e738b8e53b968e99016c059707782e14f4535359d582fc416910b3eea87"
            ],
            [
              "30e4e670435385556e593657135845d36fbb6931f72b08cb1ed954f1e3ce3ff6",
              "462f9bce619898638499350113bbc9b10a878d35da70740dc695a559eb88db7b"
            ],
            [
              "be2062003c51cc3004682904330e4dee7f3dcd10b01e580bf1971b04d4cad297",
              "62188bc49d61e5428573d48a74e1c655b1c61090905682a0d5558ed72dccb9bc"
            ],
            [
              "93144423ace3451ed29e0fb9ac2af211cb6e84a601df5993c419859fff5df04a",
              "7c10dfb164c3425f5c71a3f9d7992038f1065224f72bb9d1d902a6d13037b47c"
            ],
            [
              "b015f8044f5fcbdcf21ca26d6c34fb8197829205c7b7d2a7cb66418c157b112c",
              "ab8c1e086d04e813744a655b2df8d5f83b3cdc6faa3088c1d3aea1454e3a1d5f"
            ],
            [
              "d5e9e1da649d97d89e4868117a465a3a4f8a18de57a140d36b3f2af341a21b52",
              "4cb04437f391ed73111a13cc1d4dd0db1693465c2240480d8955e8592f27447a"
            ],
            [
              "d3ae41047dd7ca065dbf8ed77b992439983005cd72e16d6f996a5316d36966bb",
              "bd1aeb21ad22ebb22a10f0303417c6d964f8cdd7df0aca614b10dc14d125ac46"
            ],
            [
              "463e2763d885f958fc66cdd22800f0a487197d0a82e377b49f80af87c897b065",
              "bfefacdb0e5d0fd7df3a311a94de062b26b80c61fbc97508b79992671ef7ca7f"
            ],
            [
              "7985fdfd127c0567c6f53ec1bb63ec3158e597c40bfe747c83cddfc910641917",
              "603c12daf3d9862ef2b25fe1de289aed24ed291e0ec6708703a5bd567f32ed03"
            ],
            [
              "74a1ad6b5f76e39db2dd249410eac7f99e74c59cb83d2d0ed5ff1543da7703e9",
              "cc6157ef18c9c63cd6193d83631bbea0093e0968942e8c33d5737fd790e0db08"
            ],
            [
              "30682a50703375f602d416664ba19b7fc9bab42c72747463a71d0896b22f6da3",
              "553e04f6b018b4fa6c8f39e7f311d3176290d0e0f19ca73f17714d9977a22ff8"
            ],
            [
              "9e2158f0d7c0d5f26c3791efefa79597654e7a2b2464f52b1ee6c1347769ef57",
              "712fcdd1b9053f09003a3481fa7762e9ffd7c8ef35a38509e2fbf2629008373"
            ],
            [
              "176e26989a43c9cfeba4029c202538c28172e566e3c4fce7322857f3be327d66",
              "ed8cc9d04b29eb877d270b4878dc43c19aefd31f4eee09ee7b47834c1fa4b1c3"
            ],
            [
              "75d46efea3771e6e68abb89a13ad747ecf1892393dfc4f1b7004788c50374da8",
              "9852390a99507679fd0b86fd2b39a868d7efc22151346e1a3ca4726586a6bed8"
            ],
            [
              "809a20c67d64900ffb698c4c825f6d5f2310fb0451c869345b7319f645605721",
              "9e994980d9917e22b76b061927fa04143d096ccc54963e6a5ebfa5f3f8e286c1"
            ],
            [
              "1b38903a43f7f114ed4500b4eac7083fdefece1cf29c63528d563446f972c180",
              "4036edc931a60ae889353f77fd53de4a2708b26b6f5da72ad3394119daf408f9"
            ]
          ]
        }
      };
      const conf = {
        prime: "k256",
        p: "ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff fffffffe fffffc2f",
        a: "0",
        b: "7",
        n: "ffffffff ffffffff ffffffff fffffffe baaedce6 af48a03b bfd25e8c d0364141",
        h: "1",
        // Precomputed endomorphism
        beta: "7ae96a2b657c07106e64479eac3434e99cf0497512f58995c1396c28719501ee",
        lambda: "5363ad4cc05c30e0a5261c028812645a122e22ea20816678df02967c1b23bd72",
        basis: [
          {
            a: "3086d221a7d46bcde86c90e49284eb15",
            b: "-e4437ed6010e88286f547fa90abfe4c3"
          },
          {
            a: "114ca50f7a8e2f3f657c1108d9d44cfd8",
            b: "3086d221a7d46bcde86c90e49284eb15"
          }
        ],
        gRed: false,
        g: [
          "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
          "483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8",
          precomputed
        ]
      };
      this.p = new BigNumber(conf.p, 16);
      this.red = new ReductionContext(conf.prime);
      this.zero = new BigNumber(0).toRed(this.red);
      this.one = new BigNumber(1).toRed(this.red);
      this.two = new BigNumber(2).toRed(this.red);
      this.n = new BigNumber(conf.n, 16);
      this.g = Point.fromJSON(conf.g, conf.gRed);
      this._wnafT1 = new Array(4);
      this._wnafT2 = new Array(4);
      this._wnafT3 = new Array(4);
      this._wnafT4 = new Array(4);
      this._bitLength = this.n.bitLength();
      this.redN = this.n.toRed(this.red);
      this.a = new BigNumber(conf.a, 16).toRed(this.red);
      this.b = new BigNumber(conf.b, 16).toRed(this.red);
      this.tinv = this.two.redInvm();
      this.zeroA = this.a.fromRed().cmpn(0) === 0;
      this.threeA = this.a.fromRed().sub(this.p).cmpn(-3) === 0;
      this.endo = this._getEndomorphism(conf);
      this._endoWnafT1 = new Array(4);
      this._endoWnafT2 = new Array(4);
    }
    // Represent num in a w-NAF form
    static assert(expression, message = "Elliptic curve assertion failed") {
      if (!expression) {
        throw new Error(message);
      }
    }
    getNAF(num, w, bits) {
      const naf = new Array(Math.max(num.bitLength(), bits) + 1);
      naf.fill(0);
      const ws = 1 << w + 1;
      const k = num.clone();
      for (let i = 0; i < naf.length; i++) {
        let z;
        const mod = k.andln(ws - 1);
        if (k.isOdd()) {
          if (mod > (ws >> 1) - 1) {
            z = (ws >> 1) - mod;
          } else {
            z = mod;
          }
          k.isubn(z);
        } else {
          z = 0;
        }
        naf[i] = z;
        k.iushrn(1);
      }
      return naf;
    }
    // Represent k1, k2 in a Joint Sparse Form
    getJSF(k1, k2) {
      const jsf = [[], []];
      k1 = k1.clone();
      k2 = k2.clone();
      let d1 = 0;
      let d2 = 0;
      while (k1.cmpn(-d1) > 0 || k2.cmpn(-d2) > 0) {
        let m14 = k1.andln(3) + d1 & 3;
        let m24 = k2.andln(3) + d2 & 3;
        if (m14 === 3) {
          m14 = -1;
        }
        if (m24 === 3) {
          m24 = -1;
        }
        let u1;
        if ((m14 & 1) === 0) {
          u1 = 0;
        } else {
          const m8 = k1.andln(7) + d1 & 7;
          if ((m8 === 3 || m8 === 5) && m24 === 2) {
            u1 = -m14;
          } else {
            u1 = m14;
          }
        }
        jsf[0].push(u1);
        let u2;
        if ((m24 & 1) === 0) {
          u2 = 0;
        } else {
          const m8 = k2.andln(7) + d2 & 7;
          if ((m8 === 3 || m8 === 5) && m14 === 2) {
            u2 = -m24;
          } else {
            u2 = m24;
          }
        }
        jsf[1].push(u2);
        if (2 * d1 === u1 + 1) {
          d1 = 1 - d1;
        }
        if (2 * d2 === u2 + 1) {
          d2 = 1 - d2;
        }
        k1.iushrn(1);
        k2.iushrn(1);
      }
      return jsf;
    }
    static cachedProperty(obj, name, computer) {
      const key2 = "_" + name;
      obj.prototype[name] = function cachedProperty() {
        if (this[key2] === void 0) {
          this[key2] = computer.call(this);
        }
        return this[key2];
      };
    }
    static parseBytes(bytes2) {
      return typeof bytes2 === "string" ? toArray2(bytes2, "hex") : bytes2;
    }
    static intFromLE(bytes2) {
      return new BigNumber(bytes2, "hex", "le");
    }
    _getEndomorphism(conf) {
      if (!this.zeroA || this.p.modrn(3) !== 1) {
        return;
      }
      let beta;
      let lambda;
      if (conf.beta === void 0) {
        const betas = this._getEndoRoots(this.p);
        if (betas === null) {
          throw new Error("Failed to get endomorphism roots for beta.");
        }
        beta = betas[0].cmp(betas[1]) < 0 ? betas[0] : betas[1];
        beta = beta.toRed(this.red);
      } else {
        beta = new BigNumber(conf.beta, 16).toRed(this.red);
      }
      if (conf.lambda === void 0) {
        const lambdas = this._getEndoRoots(this.n);
        if (lambdas === null) {
          throw new Error("Failed to get endomorphism roots for lambda.");
        }
        if (this.g == null) {
          throw new Error("Curve generator point (g) is not defined.");
        }
        const gMulX = this.g.mul(lambdas[0])?.x;
        const gXRedMulBeta = this.g.x == null ? void 0 : this.g.x.redMul(beta);
        if (gMulX != null && gXRedMulBeta != null && gMulX.cmp(gXRedMulBeta) === 0) {
          lambda = lambdas[0];
        } else {
          lambda = lambdas[1];
          if (this.g == null) {
            throw new Error("Curve generator point (g) is not defined.");
          }
          const gMulX2 = this.g.mul(lambda)?.x;
          const gXRedMulBeta2 = this.g.x == null ? void 0 : this.g.x.redMul(beta);
          if (gMulX2 == null || gXRedMulBeta2 == null) {
            throw new Error("Lambda computation failed: g.mul(lambda).x or g.x.redMul(beta) is undefined.");
          }
          _Curve.assert(gMulX2.cmp(gXRedMulBeta2) === 0, "Lambda selection does not match computed beta.");
        }
      } else {
        lambda = new BigNumber(conf.lambda, 16);
      }
      let basis;
      if (typeof conf.basis === "object" && conf.basis !== null) {
        basis = conf.basis.map(function(vec) {
          return {
            a: new BigNumber(vec.a, 16),
            b: new BigNumber(vec.b, 16)
          };
        });
      } else {
        basis = this._getEndoBasis(lambda);
      }
      return {
        beta,
        lambda,
        basis
      };
    }
    _getEndoRoots(num) {
      const red2 = num === this.p ? this.red : new MontgomoryMethod(num);
      const tinv = new BigNumber(2).toRed(red2).redInvm();
      const ntinv = tinv.redNeg();
      const s2 = new BigNumber(3).toRed(red2).redNeg().redSqrt().redMul(tinv);
      const l1 = ntinv.redAdd(s2).fromRed();
      const l2 = ntinv.redSub(s2).fromRed();
      return [l1, l2];
    }
    _getEndoBasis(lambda) {
      const aprxSqrt = this.n.ushrn(Math.floor(this.n.bitLength() / 2));
      let u = lambda;
      let v = this.n.clone();
      let x1 = new BigNumber(1);
      let y1 = new BigNumber(0);
      let x2 = new BigNumber(0);
      let y2 = new BigNumber(1);
      let a0;
      let b0;
      let a1;
      let b1;
      let a2;
      let b2;
      let prevR = new BigNumber(0);
      let i = 0;
      let r2 = new BigNumber(0);
      let x = new BigNumber(0);
      while (u.cmpn(0) !== 0) {
        const q = v.div(u);
        r2 = v.sub(q.mul(u));
        x = x2.sub(q.mul(x1));
        const y = y2.sub(q.mul(y1));
        if (a1 === void 0 && r2.cmp(aprxSqrt) < 0) {
          a0 = prevR.neg();
          b0 = x1;
          a1 = r2.neg();
          b1 = x;
        } else if (a1 !== void 0 && ++i === 2) {
          break;
        }
        prevR = r2;
        v = u;
        u = r2;
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
      }
      if (a0 === void 0 || b0 === void 0 || a1 === void 0 || b1 === void 0) {
        throw new Error("Failed to compute Endo Basis values");
      }
      a2 = r2.neg();
      b2 = x;
      const len1 = a1.sqr().add(b1.sqr());
      const len2 = a2.sqr().add(b2.sqr());
      if (len2.cmp(len1) >= 0) {
        a2 = a0;
        b2 = b0;
      }
      if (a1.negative !== 0) {
        a1 = a1.neg();
        b1 = b1.neg();
      }
      if (a2.negative !== 0) {
        a2 = a2.neg();
        b2 = b2.neg();
      }
      return [
        { a: a1, b: b1 },
        { a: a2, b: b2 }
      ];
    }
    _endoSplit(k) {
      if (this.endo == null) {
        throw new Error("Endomorphism is not defined.");
      }
      const basis = this.endo.basis;
      const v1 = basis[0];
      const v2 = basis[1];
      const c1 = v2.b.mul(k).divRound(this.n);
      const c2 = v1.b.neg().mul(k).divRound(this.n);
      const p1 = c1.mul(v1.a);
      const p2 = c2.mul(v2.a);
      const q1 = c1.mul(v1.b);
      const q2 = c2.mul(v2.b);
      const k1 = k.sub(p1).sub(p2);
      const k2 = q1.add(q2).neg();
      return { k1, k2 };
    }
    validate(point) {
      if (point.inf) {
        return true;
      }
      const x = point.x;
      const y = point.y;
      if (x === null || y === null) {
        throw new Error("Point coordinates cannot be null");
      }
      const ax = this.a.redMul(x);
      const rhs = x.redSqr().redMul(x).redIAdd(ax).redIAdd(this.b);
      return y.redSqr().redISub(rhs).cmpn(0) === 0;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/Signature.js
  var Signature = class _Signature {
    /**
     * Creates an instance of the Signature class.
     *
     * @constructor
     * @param r - The R component of the signature.
     * @param s - The S component of the signature.
     *
     * @example
     * const r = new BigNumber('208755674028...');
     * const s = new BigNumber('564745627577...');
     * const signature = new Signature(r, s);
     */
    constructor(r2, s2) {
      /**
       * @property Represents the "r" component of the digital signature
       */
      __publicField(this, "r");
      /**
       * @property Represents the "s" component of the digital signature
       */
      __publicField(this, "s");
      this.r = r2;
      this.s = s2;
    }
    /**
     * Takes an array of numbers or a string and returns a new Signature instance.
     * This method will throw an error if the DER encoding is invalid.
     * If a string is provided, it is assumed to represent a hexadecimal sequence.
     *
     * @static
     * @method fromDER
     * @param data - The sequence to decode from DER encoding.
     * @param enc - The encoding of the data string.
     * @returns The decoded data in the form of Signature instance.
     *
     * @example
     * const signature = Signature.fromDER('30440220018c1f5502f8...', 'hex');
     */
    static fromDER(data, enc) {
      const getLength = (buf, p2) => {
        const initial = buf[p2.place++];
        if ((initial & 128) === 0) {
          return initial;
        } else {
          throw new Error("Invalid DER entity length");
        }
      };
      class Position {
        constructor() {
          __publicField(this, "place");
          this.place = 0;
        }
      }
      data = toArray2(data, enc);
      const p = new Position();
      if (data[p.place++] !== 48) {
        throw new Error("Signature DER must start with 0x30");
      }
      const len = getLength(data, p);
      if (len + p.place !== data.length) {
        throw new Error("Signature DER invalid");
      }
      if (data[p.place++] !== 2) {
        throw new Error("Signature DER invalid");
      }
      const rlen = getLength(data, p);
      let r2 = data.slice(p.place, rlen + p.place);
      p.place += rlen;
      if (data[p.place++] !== 2) {
        throw new Error("Signature DER invalid");
      }
      const slen = getLength(data, p);
      if (data.length !== slen + p.place) {
        throw new Error("Invalid R-length in signature DER");
      }
      let s2 = data.slice(p.place, slen + p.place);
      if (r2[0] === 0) {
        if ((r2[1] & 128) === 0) {
          throw new Error("Invalid R-value in signature DER");
        } else {
          r2 = r2.slice(1);
        }
      }
      if (s2[0] === 0) {
        if ((s2[1] & 128) === 0) {
          throw new Error("Invalid S-value in signature DER");
        } else {
          s2 = s2.slice(1);
        }
      }
      return new _Signature(new BigNumber(r2), new BigNumber(s2));
    }
    /**
     * Takes an array of numbers or a string and returns a new Signature instance.
     * This method will throw an error if the Compact encoding is invalid.
     * If a string is provided, it is assumed to represent a hexadecimal sequence.
     * compactByte value 27-30 means uncompressed public key.
     * 31-34 means compressed public key.
     * The range represents the recovery param which can be 0,1,2,3.
     * We could support recovery functions in future if there's demand.
     *
     * @static
     * @method fromCompact
     * @param data - The sequence to decode from Compact encoding.
     * @param enc - The encoding of the data string.
     * @returns The decoded data in the form of Signature instance.
     *
     * @example
     * const signature = Signature.fromCompact('1b18c1f5502f8...', 'hex');
     */
    static fromCompact(data, enc) {
      data = toArray2(data, enc);
      if (data.length !== 65) {
        throw new Error("Invalid Compact Signature");
      }
      const compactByte = data[0];
      if (compactByte < 27 || compactByte >= 35) {
        throw new Error("Invalid Compact Byte");
      }
      return new _Signature(new BigNumber(data.slice(1, 33)), new BigNumber(data.slice(33, 65)));
    }
    /**
     * Verifies a digital signature.
     *
     * This method will return true if the signature, key, and message hash match.
     * If the data or key do not match the signature, the function returns false.
     *
     * @method verify
     * @param msg - The message to verify.
     * @param key - The public key used to sign the original message.
     * @param enc - The encoding of the msg string.
     * @returns A boolean representing whether the signature is valid.
     *
     * @example
     * const msg = 'The quick brown fox jumps over the lazy dog';
     * const publicKey = PublicKey.fromString('04188ca1050...');
     * const isVerified = signature.verify(msg, publicKey);
     */
    verify(msg, key2, enc) {
      const msgHash = new BigNumber(sha256(msg, enc), 16);
      return verify(msgHash, this, key2);
    }
    /**
     * Converts an instance of Signature into DER encoding.
     * An alias for the toDER method.
     *
     * If the encoding parameter is set to 'hex', the function will return a hex string.
     * If 'base64', it will return a base64 string.
     * Otherwise, it will return an array of numbers.
     *
     * @method toDER
     * @param enc - The encoding to use for the output.
     * @returns The current instance in DER encoding.
     *
     * @example
     * const der = signature.toString('base64');
     */
    toString(enc) {
      return this.toDER(enc);
    }
    /**
     * Converts an instance of Signature into DER encoding.
     *
     * If the encoding parameter is set to 'hex', the function will return a hex string.
     * If 'base64', it will return a base64 string.
     * Otherwise, it will return an array of numbers.
     *
     * @method toDER
     * @param enc - The encoding to use for the output.
     * @returns The current instance in DER encoding.
     *
     * @example
     * const der = signature.toDER('hex');
     */
    toDER(enc) {
      const constructLength = (arr2, len) => {
        if (len < 128) {
          arr2.push(len);
        } else {
          throw new Error("len must be < 0x80");
        }
      };
      const rmPadding = (buf) => {
        let i = 0;
        const len = buf.length - 1;
        while (buf[i] === 0 && (buf[i + 1] & 128) === 0 && i < len) {
          i++;
        }
        if (i === 0) {
          return buf;
        }
        return buf.slice(i);
      };
      let r2 = this.r.toArray();
      let s2 = this.s.toArray();
      if ((r2[0] & 128) !== 0) {
        r2 = [0].concat(r2);
      }
      if ((s2[0] & 128) !== 0) {
        s2 = [0].concat(s2);
      }
      r2 = rmPadding(r2);
      s2 = rmPadding(s2);
      while (s2[0] === 0 && (s2[1] & 128) === 0) {
        s2 = s2.slice(1);
      }
      let arr = [2];
      constructLength(arr, r2.length);
      arr = arr.concat(r2);
      arr.push(2);
      constructLength(arr, s2.length);
      const backHalf = arr.concat(s2);
      let res = [48];
      constructLength(res, backHalf.length);
      res = res.concat(backHalf);
      if (enc === "hex") {
        return toHex(res);
      } else if (enc === "base64") {
        return toBase64(res);
      } else {
        return res;
      }
    }
    /**
     * Converts an instance of Signature into Compact encoding.
     *
     * If the encoding parameter is set to 'hex', the function will return a hex string.
     * If 'base64', it will return a base64 string.
     * Otherwise, it will return an array of numbers.
     *
     * @method toCompact
     * @param enc - The encoding to use for the output.
     * @returns The current instance in DER encoding.
     *
     * @example
     * const compact = signature.toCompact(3, true, 'base64');
     */
    toCompact(recovery, compressed, enc) {
      if (recovery < 0 || recovery > 3)
        throw new Error("Invalid recovery param");
      if (typeof compressed !== "boolean") {
        throw new TypeError("Invalid compressed param");
      }
      let compactByte = 27 + recovery;
      if (compressed) {
        compactByte += 4;
      }
      let arr = [compactByte];
      arr = arr.concat(this.r.toArray("be", 32));
      arr = arr.concat(this.s.toArray("be", 32));
      if (enc === "hex") {
        return toHex(arr);
      } else if (enc === "base64") {
        return toBase64(arr);
      } else {
        return arr;
      }
    }
    /**
     * Recovers the public key from a signature.
     * This method will return the public key if it finds a valid public key.
     * If it does not find a valid public key, it will throw an error.
     * The recovery factor is a number between 0 and 3.
     * @method RecoverPublicKey
     * @param recovery - The recovery factor.
     * @param e - The message hash.
     * @returns The public key associated with the signature.
     *
     * @example
     * const publicKey = signature.RecoverPublicKey(0, msgHash);
     */
    RecoverPublicKey(recovery, e) {
      const r2 = this.r;
      const s2 = this.s;
      const isYOdd = (recovery & 1) !== 0;
      const isSecondKey = recovery >> 1;
      const curve2 = new Curve();
      const n = curve2.n;
      const G = curve2.g;
      const x = isSecondKey === 0 ? r2 : r2.add(n);
      const R2 = Point.fromX(x, isYOdd);
      const nR = R2.mul(n);
      if (!nR.isInfinity()) {
        throw new Error("nR is not at infinity");
      }
      const eNeg = e.neg().umod(n);
      const rInv = r2.invm(n);
      const srInv = rInv.mul(s2).umod(n);
      const eInvrInv = rInv.mul(eNeg).umod(n);
      const Q = G.mul(eInvrInv).add(R2.mul(srInv));
      const pubKey = new PublicKey(Q);
      pubKey.validate();
      return pubKey;
    }
    /**
     * Calculates the recovery factor which will work for a particular public key and message hash.
     * This method will return the recovery factor if it finds a valid recovery factor.
     * If it does not find a valid recovery factor, it will throw an error.
     * The recovery factor is a number between 0 and 3.
     *
     * @method CalculateRecoveryFactor
     * @param msgHash - The message hash.
     * @returns the recovery factor: number
     * /
     * @example
     * const recovery = signature.CalculateRecoveryFactor(publicKey, msgHash);
     */
    CalculateRecoveryFactor(pubkey, msgHash) {
      for (let recovery = 0; recovery < 4; recovery++) {
        let Qprime;
        try {
          Qprime = this.RecoverPublicKey(recovery, msgHash);
        } catch {
          continue;
        }
        if (pubkey.eq(Qprime)) {
          return recovery;
        }
      }
      throw new Error("Unable to find valid recovery factor");
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/DRBG.js
  var DRBG = class {
    constructor(entropy, nonce) {
      __publicField(this, "K");
      __publicField(this, "V");
      const entropyBytes = toArray2(entropy, "hex");
      const nonceBytes = toArray2(nonce, "hex");
      if (entropyBytes.length !== 32) {
        throw new Error("Entropy must be exactly 32 bytes (256 bits)");
      }
      if (nonceBytes.length !== 32) {
        throw new Error("Nonce must be exactly 32 bytes (256 bits)");
      }
      const seedMaterial = entropyBytes.concat(nonceBytes);
      this.K = new Array(32);
      this.V = new Array(32);
      for (let i = 0; i < 32; i++) {
        this.K[i] = 0;
        this.V[i] = 1;
      }
      this.update(seedMaterial);
    }
    /**
     * Generates HMAC using the K value of the instance. This method is used internally for operations.
     *
     * @method hmac
     * @returns The SHA256HMAC object created with K value.
     *
     * @example
     * const hmac = drbg.hmac();
     */
    hmac() {
      return new SHA256HMAC(this.K);
    }
    /**
     * Updates the `K` and `V` values of the instance based on the seed.
     * The seed if not provided uses `V` as seed.
     *
     * @method update
     * @param seed - an optional value that used to update `K` and `V`. Default is `undefined`.
     * @returns Nothing, but updates the internal state `K` and `V` value.
     *
     * @example
     * drbg.update('e13af...');
     */
    update(seed) {
      let kmac = this.hmac().update(this.V).update([0]);
      if (seed !== void 0) {
        kmac = kmac.update(seed);
      }
      this.K = kmac.digest();
      this.V = this.hmac().update(this.V).digest();
      if (seed === void 0) {
        return;
      }
      this.K = this.hmac().update(this.V).update([1]).update(seed).digest();
      this.V = this.hmac().update(this.V).digest();
    }
    /**
     * Generates deterministic random hexadecimal string of given length.
     * In every generation process, it also updates the internal state `K` and `V`.
     *
     * @method generate
     * @param len - The length of required random number.
     * @returns The required deterministic random hexadecimal string.
     *
     * @example
     * const randomHex = drbg.generate(256);
     */
    generate(len) {
      let temp = [];
      while (temp.length < len) {
        this.V = this.hmac().update(this.V).digest();
        temp = temp.concat(this.V);
      }
      const res = temp.slice(0, len);
      this.update();
      return toHex(res);
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/ECDSA.js
  function truncateToN(msg, truncOnly, curve2 = new Curve()) {
    const delta = msg.byteLength() * 8 - curve2.n.bitLength();
    if (delta > 0) {
      msg.iushrn(delta);
    }
    if (truncOnly !== true && msg.cmp(curve2.n) >= 0) {
      return msg.sub(curve2.n);
    } else {
      return msg;
    }
  }
  function bnToBigInt(bn) {
    const bytes2 = bn.toArray("be");
    let x = 0n;
    for (const byte of bytes2) {
      x = x << 8n | BigInt(byte);
    }
    return x;
  }
  var curve = new Curve();
  var bytes = curve.n.byteLength();
  var ns1 = curve.n.subn(1);
  var halfN = N_BIGINT >> 1n;
  var sign = (msg, key2, forceLowS = false, customK) => {
    const nBitLength = curve.n.bitLength();
    if (msg.bitLength() > nBitLength) {
      throw new Error(`ECDSA message is too large: expected <= ${nBitLength} bits. Callers must hash messages before signing.`);
    }
    msg = truncateToN(msg);
    const msgBig = bnToBigInt(msg);
    const keyBig = bnToBigInt(key2);
    const bkey = key2.toArray("be", bytes);
    const nonce = msg.toArray("be", bytes);
    const drbg = new DRBG(bkey, nonce);
    for (let iter = 0; ; iter++) {
      let kBN;
      if (typeof customK === "function") {
        kBN = customK(iter);
      } else if (BigNumber.isBN(customK)) {
        kBN = customK;
      } else {
        kBN = new BigNumber(drbg.generate(bytes), 16);
      }
      if (kBN == null) {
        throw new Error("k is undefined");
      }
      kBN = truncateToN(kBN, true);
      if (kBN.cmpn(1) < 0 || kBN.cmp(ns1) > 0) {
        if (BigNumber.isBN(customK)) {
          throw new Error("Invalid fixed custom K value (must be >1 and <N-1)");
        }
        continue;
      }
      const R2 = curve.g.mulCT(kBN);
      if (R2.isInfinity()) {
        if (BigNumber.isBN(customK)) {
          throw new Error("Invalid fixed custom K value (k\xB7G at infinity)");
        }
        continue;
      }
      const xAff = BigInt("0x" + R2.getX().toString(16));
      const rBig = modN(xAff);
      if (rBig === 0n) {
        if (BigNumber.isBN(customK)) {
          throw new Error("Invalid fixed custom K value (r == 0)");
        }
        continue;
      }
      const kBig = BigInt("0x" + kBN.toString(16));
      const kInv = modInvN(kBig);
      const rTimesKey = modMulN(rBig, keyBig);
      const sum = modN(msgBig + rTimesKey);
      let sBig = modMulN(kInv, sum);
      if (sBig === 0n) {
        if (BigNumber.isBN(customK)) {
          throw new Error("Invalid fixed custom K value (s == 0)");
        }
        continue;
      }
      if (forceLowS && sBig > halfN) {
        sBig = N_BIGINT - sBig;
      }
      const r2 = new BigNumber(rBig.toString(16), 16);
      const s2 = new BigNumber(sBig.toString(16), 16);
      return new Signature(r2, s2);
    }
  };
  var verify = (msg, sig, key2) => {
    const nBitLength = curve.n.bitLength();
    if (msg.bitLength() > nBitLength) {
      return false;
    }
    const hash = bnToBigInt(msg);
    if (key2.x == null || key2.y == null) {
      throw new Error("Invalid public key: missing coordinates.");
    }
    const publicKey = {
      x: bnToBigInt(key2.x),
      y: bnToBigInt(key2.y)
    };
    const signature = {
      r: bnToBigInt(sig.r),
      s: bnToBigInt(sig.s)
    };
    const { r: r2, s: s2 } = signature;
    const z = hash;
    if (r2 <= BI_ZERO || r2 >= N_BIGINT || s2 <= BI_ZERO || s2 >= N_BIGINT) {
      return false;
    }
    const w = modInvN(s2);
    if (w === 0n)
      return false;
    const u1 = modMulN(z, w);
    const u2 = modMulN(r2, w);
    const RG = scalarMultiplyWNAF(u1, { x: GX_BIGINT, y: GY_BIGINT });
    const RQ = scalarMultiplyWNAF(u2, publicKey);
    const R2 = jpAdd(RG, RQ);
    if (R2.Z === 0n)
      return false;
    const zInv = biModInv(R2.Z);
    const zInv2 = biModMul(zInv, zInv);
    const xAff = biModMul(R2.X, zInv2);
    const v = modN(xAff);
    return v === r2;
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/PublicKey.js
  var PublicKey = class _PublicKey extends Point {
    /**
     * Static factory method to derive a public key from a private key.
     * It multiplies the generator point 'g' on the elliptic curve by the private key.
     *
     * @static
     * @method fromPrivateKey
     *
     * @param key - The private key from which to derive the public key.
     *
     * @returns Returns the PublicKey derived from the given PrivateKey.
     *
     * @example
     * const myPrivKey = new PrivateKey(...)
     * const myPubKey = PublicKey.fromPrivateKey(myPrivKey)
     */
    static fromPrivateKey(key2) {
      const c = new Curve();
      const p = c.g.mul(key2);
      return new _PublicKey(p.x, p.y);
    }
    /**
     * Static factory method to create a PublicKey instance from a string.
     *
     * @param str - A string representing a public key.
     *
     * @returns Returns the PublicKey created from the string.
     *
     * @example
     * const myPubKey = PublicKey.fromString("03....")
     */
    static fromString(str) {
      const p = Point.fromString(str);
      return new _PublicKey(p.x, p.y);
    }
    /**
     * Static factory method to create a PublicKey instance from a number array.
     *
     * @param bytes - A number array representing a public key.
     *
     * @returns Returns the PublicKey created from the number array.
     *
     * @example
     * const myPubKey = PublicKey.fromString("03....")
     */
    static fromDER(bytes2) {
      const p = Point.fromDER(bytes2);
      return new _PublicKey(p.x, p.y);
    }
    /**
     * @constructor
     * @param x - A point or the x-coordinate of the point. May be a number, a BigNumber, a string (which will be interpreted as hex), a number array, or null. If null, an "Infinity" point is constructed.
     * @param y - If x is not a point, the y-coordinate of the point, similar to x.
     * @param isRed - A boolean indicating if the point is a member of the field of integers modulo the k256 prime. Default is true.
     *
     * @example
     * new PublicKey(point1);
     * new PublicKey('abc123', 'def456');
     */
    constructor(x, y = null, isRed = true) {
      if (x instanceof Point) {
        super(x.getX(), x.getY());
      } else {
        if (y === null && isRed && typeof x === "string") {
          if (x.length === 66 || x.length === 130) {
            throw new Error('You are using the "new PublicKey()" constructor with a DER hex string. You need to use "PublicKey.fromString()" instead.');
          }
        }
        super(x, y, isRed);
      }
    }
    /**
     * Derive a shared secret from a public key and a private key for use in symmetric encryption.
     * This method multiplies the public key (an instance of Point) with a private key.
     *
     * @param priv - The private key to use in deriving the shared secret.
     *
     * @returns Returns the Point representing the shared secret.
     *
     * @throws Will throw an error if the public key is not valid for ECDH secret derivation.
     *
     * @example
     * const myPrivKey = new PrivateKey(...)
     * const sharedSecret = myPubKey.deriveSharedSecret(myPrivKey)
     */
    deriveSharedSecret(priv) {
      if (!this.validate()) {
        throw new Error("Public key not valid for ECDH secret derivation");
      }
      return this.mulCT(priv);
    }
    /**
     * Verify a signature of a message using this public key.
     *
     * @param msg - The message to verify. It can be a string or an array of numbers.
     * @param sig - The Signature of the message that needs verification.
     * @param enc - The encoding of the message. It defaults to 'utf8'.
     *
     * @returns Returns true if the signature is verified successfully, otherwise false.
     *
     * @example
     * const myMessage = "Hello, world!"
     * const mySignature = new Signature(...)
     * const isVerified = myPubKey.verify(myMessage, mySignature)
     */
    verify(msg, sig, enc) {
      const msgHash = new BigNumber(sha256(msg, enc), 16);
      return verify(msgHash, sig, this);
    }
    /**
     * Encode the public key to DER (Distinguished Encoding Rules) format.
     *
     * @returns Returns the DER-encoded public key in number array or string.
     *
     * @param enc - The encoding of the DER string. undefined = number array, 'hex' = hex string.
     *
     * @example
     * const derPublicKey = myPubKey.toDER()
     */
    toDER(enc) {
      if (enc === "hex")
        return this.encode(true, enc);
      return this.encode(true);
    }
    /**
     * Hash sha256 and ripemd160 of the public key.
     *
     * @returns Returns the hash of the public key.
     *
     * @example
     * const publicKeyHash = pubkey.toHash()
     */
    toHash(enc) {
      const pkh = hash160(this.encode(true));
      if (enc === "hex") {
        return toHex(pkh);
      }
      return pkh;
    }
    /**
     * Base58Check encodes the hash of the public key with a prefix to indicate locking script type.
     * Defaults to P2PKH for mainnet, otherwise known as a "Bitcoin Address".
     *
     * @param prefix defaults to [0x00] for mainnet, set to [0x6f] for testnet or use the strings 'mainnet' or 'testnet'
     *
     * @returns Returns the address encoding associated with the hash of the public key.
     *
     * @example
     * const address = pubkey.toAddress()
     * const address = pubkey.toAddress('mainnet')
     * const testnetAddress = pubkey.toAddress([0x6f])
     * const testnetAddress = pubkey.toAddress('testnet')
     */
    toAddress(prefix = [0]) {
      if (typeof prefix === "string") {
        if (prefix === "testnet" || prefix === "test") {
          prefix = [111];
        } else if (prefix === "mainnet" || prefix === "main") {
          prefix = [0];
        } else {
          throw new Error(`Invalid prefix ${prefix}`);
        }
      }
      return toBase58Check(this.toHash(), prefix);
    }
    /**
     * Derives a child key with BRC-42.
     * @param privateKey The private key of the other party
     * @param invoiceNumber The invoice number used to derive the child key
     * @param cacheSharedSecret Optional function to cache shared secrets
     * @param retrieveCachedSharedSecret Optional function to retrieve shared secrets from the cache
     * @returns The derived child key.
     */
    deriveChild(privateKey, invoiceNumber, cacheSharedSecret, retrieveCachedSharedSecret) {
      let sharedSecret;
      if (typeof retrieveCachedSharedSecret === "function") {
        const retrieved = retrieveCachedSharedSecret(privateKey, this);
        if (retrieved === void 0) {
          sharedSecret = this.deriveSharedSecret(privateKey);
          if (typeof cacheSharedSecret === "function") {
            cacheSharedSecret(privateKey, this, sharedSecret);
          }
        } else {
          sharedSecret = retrieved;
        }
      } else {
        sharedSecret = this.deriveSharedSecret(privateKey);
      }
      const invoiceNumberBin = toArray2(invoiceNumber, "utf8");
      const hmac2 = sha256hmac(sharedSecret.encode(true), invoiceNumberBin);
      const curve2 = new Curve();
      const point = curve2.g.mul(new BigNumber(hmac2));
      const finalPoint = this.add(point);
      return new _PublicKey(finalPoint.x, finalPoint.y);
    }
    /**
     * Takes an array of numbers or a string and returns a new PublicKey instance.
     * This method will throw an error if the Compact encoding is invalid.
     * If a string is provided, it is assumed to represent a hexadecimal sequence.
     * compactByte value 27-30 means uncompressed public key.
     * 31-34 means compressed public key.
     * The range represents the recovery param which can be 0,1,2,3.
     *
     * @static
     * @method fromMsgHashAndCompactSignature
     * @param msgHash - The message hash which was signed.
     * @param signature - The signature in compact format.
     * @param enc - The encoding of the signature string.
     * @returns A PublicKey instance derived from the message hash and compact signature.
     * @example
     * const publicKey = Signature.fromMsgHashAndCompactSignature(msgHash, 'IMOl2mVKfDgsSsHT4uIYBNN4e...', 'base64');
     */
    static fromMsgHashAndCompactSignature(msgHash, signature, enc) {
      const data = toArray2(signature, enc);
      if (data.length !== 65) {
        throw new Error("Invalid Compact Signature");
      }
      const compactByte = data[0];
      if (compactByte < 27 || compactByte >= 35) {
        throw new Error("Invalid Compact Byte");
      }
      let r2 = data[0] - 27;
      if (r2 > 3) {
        r2 -= 4;
      }
      const s2 = new Signature(new BigNumber(data.slice(1, 33)), new BigNumber(data.slice(33, 65)));
      return s2.RecoverPublicKey(r2, msgHash);
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/Random.js
  var Rand = class {
    constructor() {
      __publicField(this, "_rand");
      const noRand = () => {
        throw new Error("No secure random number generator is available in this environment.");
      };
      this._rand = noRand;
      if (typeof globalThis !== "undefined" && typeof globalThis.crypto?.getRandomValues === "function") {
        this._rand = (n) => {
          return this.getRandomValues(globalThis, n);
        };
        return;
      }
      if (typeof process !== "undefined" && process.release?.name === "node") {
        try {
          const crypto = __require("node:crypto");
          if (typeof crypto.randomBytes === "function") {
            this._rand = (n) => {
              return Array.from(crypto.randomBytes(n));
            };
            return;
          }
        } catch (_cryptoModuleUnavailable) {
        }
      }
      if (typeof globalThis.self !== "undefined" && typeof globalThis.self.crypto?.getRandomValues === "function") {
        this._rand = (n) => {
          return this.getRandomValues(globalThis.self, n);
        };
        return;
      }
      if (typeof globalThis.window !== "undefined" && typeof globalThis.window.crypto?.getRandomValues === "function") {
        this._rand = (n) => {
          return this.getRandomValues(globalThis.window, n);
        };
        return;
      }
      this._rand = noRand;
    }
    // ✅ Explicit function type
    getRandomValues(obj, n) {
      const arr = new Uint8Array(n);
      obj.crypto.getRandomValues(arr);
      return Array.from(arr);
    }
    generate(len) {
      return this._rand(len);
    }
  };
  var ayn = null;
  var Random = (len) => {
    ayn ?? (ayn = new Rand());
    return ayn.generate(len);
  };
  var Random_default = Random;

  // node_modules/@bsv/sdk/dist/esm/src/primitives/Polynomial.js
  var PointInFiniteField = class _PointInFiniteField {
    constructor(x, y) {
      __publicField(this, "x");
      __publicField(this, "y");
      const P2 = new Curve().p;
      this.x = x.umod(P2);
      this.y = y.umod(P2);
    }
    toString() {
      return toBase58(this.x.toArray()) + "." + toBase58(this.y.toArray());
    }
    static fromString(str) {
      const [x, y] = str.split(".");
      return new _PointInFiniteField(new BigNumber(fromBase58(x)), new BigNumber(fromBase58(y)));
    }
  };
  var Polynomial = class _Polynomial {
    constructor(points, threshold) {
      __publicField(this, "points");
      __publicField(this, "threshold");
      this.points = points;
      this.threshold = threshold ?? points.length;
    }
    static fromPrivateKey(key2, threshold) {
      const P2 = new Curve().p;
      const points = [
        new PointInFiniteField(new BigNumber(0), new BigNumber(key2.toArray()))
      ];
      for (let i = 1; i < threshold; i++) {
        const randomX = new BigNumber(Random_default(32)).umod(P2);
        const randomY = new BigNumber(Random_default(32)).umod(P2);
        points.push(new PointInFiniteField(randomX, randomY));
      }
      return new _Polynomial(points);
    }
    // Evaluate the polynomial at x by using Lagrange interpolation
    valueAt(x) {
      const P2 = new Curve().p;
      let y = new BigNumber(0);
      for (let i = 0; i < this.threshold; i++) {
        let term = this.points[i].y;
        for (let j = 0; j < this.threshold; j++) {
          if (i !== j) {
            const xj = this.points[j].x;
            const xi = this.points[i].x;
            const numerator = x.sub(xj).umod(P2);
            const denominator = xi.sub(xj).umod(P2);
            const denominatorInverse = denominator.invm(P2);
            const fraction = numerator.mul(denominatorInverse).umod(P2);
            term = term.mul(fraction).umod(P2);
          }
        }
        y = y.add(term).umod(P2);
      }
      return y;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/PrivateKey.js
  var KeyShares = class _KeyShares {
    constructor(points, threshold, integrity) {
      __publicField(this, "points");
      __publicField(this, "threshold");
      __publicField(this, "integrity");
      this.points = points;
      this.threshold = threshold;
      this.integrity = integrity;
    }
    static fromBackupFormat(shares) {
      let threshold = 0;
      let integrity = "";
      const points = shares.map((share, idx) => {
        const shareParts = share.split(".");
        if (shareParts.length !== 4) {
          throw new Error("Invalid share format in share " + idx.toString() + '. Expected format: "x.y.t.i" - received ' + share);
        }
        const [x, y, t, i] = shareParts;
        if (t === void 0)
          throw new Error("Threshold not found in share " + idx.toString());
        if (i === void 0)
          throw new Error("Integrity not found in share " + idx.toString());
        const tInt = Number.parseInt(t, 10);
        if (idx !== 0 && threshold !== tInt) {
          throw new Error("Threshold mismatch in share " + idx.toString());
        }
        if (idx !== 0 && integrity !== i) {
          throw new Error("Integrity mismatch in share " + idx.toString());
        }
        threshold = tInt;
        integrity = i;
        return PointInFiniteField.fromString([x, y].join("."));
      });
      return new _KeyShares(points, threshold, integrity);
    }
    toBackupFormat() {
      return this.points.map((share) => share.toString() + "." + this.threshold.toString() + "." + this.integrity);
    }
  };
  var PrivateKey = class _PrivateKey extends BigNumber {
    /**
     * Generates a private key randomly.
     *
     * @method fromRandom
     * @static
     * @returns The newly generated Private Key.
     *
     * @example
     * const privateKey = PrivateKey.fromRandom();
     */
    static fromRandom() {
      return new _PrivateKey(Random_default(32));
    }
    /**
     * Generates a private key from a string.
     *
     * @method fromString
     * @static
     * @param str - The string to generate the private key from.
     * @param base - The base of the string.
     * @returns The generated Private Key.
     * @throws Will throw an error if the string is not valid.
     **/
    static fromString(str, base = "hex") {
      return new _PrivateKey(super.fromString(str, base).toArray());
    }
    /**
     * Generates a private key from a hexadecimal string.
     *
     * @method fromHex
     * @static
     * @param {string} str - The hexadecimal string representing the private key. The string must represent a valid private key in big-endian format.
     * @returns {PrivateKey} The generated Private Key instance.
     * @throws {Error} If the string is not a valid hexadecimal or represents an invalid private key.
     **/
    static fromHex(str) {
      return new _PrivateKey(super.fromHex(str, "big"));
    }
    /**
     * Generates a private key from a WIF (Wallet Import Format) string.
     *
     * @method fromWif
     * @static
     * @param wif - The WIF string to generate the private key from.
     * @param base - The base of the string.
     * @returns The generated Private Key.
     * @throws Will throw an error if the string is not a valid WIF.
     **/
    static fromWif(wif, prefixLength = 1) {
      const decoded = fromBase58Check(wif, void 0, prefixLength);
      if (decoded.data.length !== 33) {
        throw new Error("Invalid WIF length");
      }
      if (decoded.data[32] !== 1) {
        throw new Error("Invalid WIF padding");
      }
      return new _PrivateKey(decoded.data.slice(0, 32));
    }
    /**
     * @constructor
     *
     * @param number - The number (various types accepted) to construct a BigNumber from. Default is 0.
     *
     * @param base - The base of number provided. By default is 10. Ignored if number is BigNumber.
     *
     * @param endian - The endianness provided. By default is 'big endian'. Ignored if number is BigNumber.
     *
     * @param modN - Optional. Default 'apply. If 'apply', apply modN to input to guarantee a valid PrivateKey. If 'error', if input is out of field throw new Error('Input is out of field'). If 'nocheck', assumes input is in field.
     *
     * @example
     * import PrivateKey from './PrivateKey';
     * import BigNumber from './BigNumber';
     * const privKey = new PrivateKey(new BigNumber('123456', 10, 'be'));
     */
    constructor(number = 0, base = 10, endian = "be", modN2 = "apply") {
      if (number instanceof BigNumber) {
        super();
        number.copy(this);
      } else {
        super(number, base, endian);
      }
      if (modN2 !== "nocheck") {
        const check = this.checkInField();
        if (!check.inField) {
          if (modN2 === "error") {
            throw new Error("Input is out of field");
          }
          BigNumber.move(this, check.modN);
        }
      }
    }
    /**
     * A utility function to check that the value of this PrivateKey lies in the field limited by curve.n
     * @returns { inField, modN } where modN is this PrivateKey's current BigNumber value mod curve.n, and inField is true only if modN equals current BigNumber value.
     */
    checkInField() {
      const curve2 = new Curve();
      const modN2 = this.mod(curve2.n);
      const inField = this.cmp(modN2) === 0;
      return { inField, modN: modN2 };
    }
    /**
     * @returns true if the PrivateKey's current BigNumber value lies in the field limited by curve.n
     */
    isValid() {
      return this.checkInField().inField;
    }
    /**
     * Signs a message using the private key.
     *
     * @method sign
     * @param msg - The message (array of numbers or string) to be signed.
     * @param enc - If 'hex' the string will be treated as hex, utf8 otherwise.
     * @param forceLowS - If true (the default), the signature will be forced to have a low S value.
     * @param customK — If provided, uses a custom K-value for the signature. Provie a function that returns a BigNumber, or the BigNumber itself.
     * @returns A digital signature generated from the hash of the message and the private key.
     *
     * @example
     * const privateKey = PrivateKey.fromRandom();
     * const signature = privateKey.sign('Hello, World!');
     */
    sign(msg, enc, forceLowS = true, customK) {
      const msgHash = new BigNumber(sha256(msg, enc), 16);
      return sign(msgHash, this, forceLowS, customK);
    }
    /**
     * Verifies a message's signature using the public key associated with this private key.
     *
     * @method verify
     * @param msg - The original message which has been signed.
     * @param sig - The signature to be verified.
     * @param enc - The data encoding method.
     * @returns Whether or not the signature is valid.
     *
     * @example
     * const privateKey = PrivateKey.fromRandom();
     * const signature = privateKey.sign('Hello, World!');
     * const isSignatureValid = privateKey.verify('Hello, World!', signature);
     */
    verify(msg, sig, enc) {
      const msgHash = new BigNumber(sha256(msg, enc), 16);
      return verify(msgHash, sig, this.toPublicKey());
    }
    /**
     * Converts the private key to its corresponding public key.
     *
     * The public key is generated by multiplying the base point G of the curve and the private key.
     *
     * @method toPublicKey
     * @returns The generated PublicKey.
     *
     * @example
     * const privateKey = PrivateKey.fromRandom();
     * const publicKey = privateKey.toPublicKey();
     */
    toPublicKey() {
      const c = new Curve();
      const p = c.g.mulCT(this);
      return new PublicKey(p.x, p.y);
    }
    /**
     * Converts the private key to a Wallet Import Format (WIF) string.
     *
     * Base58Check encoding is used for encoding the private key.
     * The prefix
     *
     * @method toWif
     * @returns The WIF string.
     *
     * @param prefix defaults to [0x80] for mainnet, set it to [0xef] for testnet.
     *
     * @throws Error('Value is out of field') if current BigNumber value is out of field limited by curve.n
     *
     * @example
     * const privateKey = PrivateKey.fromRandom();
     * const wif = privateKey.toWif();
     * const testnetWif = privateKey.toWif([0xef]);
     */
    toWif(prefix = [128]) {
      if (!this.isValid()) {
        throw new Error("Value is out of field");
      }
      return toBase58Check([...this.toArray("be", 32), 1], prefix);
    }
    /**
     * Base58Check encodes the hash of the public key associated with this private key with a prefix to indicate locking script type.
     * Defaults to P2PKH for mainnet, otherwise known as a "Bitcoin Address".
     *
     * @param prefix defaults to [0x00] for mainnet, set to [0x6f] for testnet or use the strings 'testnet' or 'mainnet'
     *
     * @returns Returns the address encoding associated with the hash of the public key associated with this private key.
     *
     * @example
     * const address = privkey.toAddress()
     * const address = privkey.toAddress('mainnet')
     * const testnetAddress = privkey.toAddress([0x6f])
     * const testnetAddress = privkey.toAddress('testnet')
     */
    toAddress(prefix = [0]) {
      return this.toPublicKey().toAddress(prefix);
    }
    /**
     * Converts this PrivateKey to a hexadecimal string.
     *
     * @method toHex
     * @param length - The minimum length of the hex string
     * @returns Returns a string representing the hexadecimal value of this BigNumber.
     *
     * @example
     * const bigNumber = new BigNumber(255);
     * const hex = bigNumber.toHex();
     */
    toHex() {
      return super.toHex(32);
    }
    /**
     * Converts this PrivateKey to a string representation.
     *
     * @method toString
     * @param {number | 'hex'} [base='hex'] - The base for representing the number. Default is hexadecimal ('hex').
     * @param {number} [padding=64] - The minimum number of digits for the output string. Default is 64, ensuring a 256-bit representation in hexadecimal.
     * @returns {string} A string representation of the PrivateKey in the specified base, padded to the specified length.
     *
     **/
    toString(base = "hex", padding = 64) {
      return super.toString(base, padding);
    }
    /**
     * Derives a shared secret from the public key.
     *
     * @method deriveSharedSecret
     * @param key - The public key to derive the shared secret from.
     * @returns The derived shared secret (a point on the curve).
     * @throws Will throw an error if the public key is not valid.
     *
     * @example
     * const privateKey = PrivateKey.fromRandom();
     * const publicKey = privateKey.toPublicKey();
     * const sharedSecret = privateKey.deriveSharedSecret(publicKey);
     */
    deriveSharedSecret(key2) {
      if (!key2.validate()) {
        throw new Error("Public key not valid for ECDH secret derivation");
      }
      return key2.mulCT(this);
    }
    /**
     * SECURITY NOTE – DETERMINISTIC CHILD KEY DERIVATION
     *
     * This method derives child private keys deterministically from the caller’s
     * long-term private key, the counterparty’s public key, and a caller-supplied
     * invoice number using HMAC over an ECDH shared secret (BRC-42 style derivation).
     *
     * This construction does NOT implement a formally authenticated key exchange
     * (AKE) and does NOT provide the following security properties:
     *
     *  - Forward secrecy: Compromise of a long-term private key compromises all
     *    past and future child keys derived from it.
     *  - Replay protection: Child keys are deterministic for a given invoice
     *    number and key pair; previously observed messages can be replayed.
     *  - Explicit authentication / identity binding: Possession of a public key
     *    alone does not guarantee the intended peer identity, enabling potential
     *    identity misbinding attacks if higher-level identity verification is absent.
     *
     * This derivation is intended for lightweight, deterministic key hierarchies
     * where both parties already possess and trust each other’s long-term public
     * keys. It SHOULD NOT be used as a drop-in replacement for a standard
     * authenticated key exchange (e.g. X3DH, Noise, or SIGMA) in high-security or
     * high-value contexts.
     *
     * Any future protocol providing forward secrecy, replay protection, or strong
     * peer authentication will require a versioned, breaking change.
     */
    /**
     * Derives a child key with BRC-42.
     * @param publicKey The public key of the other party
     * @param invoiceNumber The invoice number used to derive the child key
     * @param cacheSharedSecret Optional function to cache shared secrets
     * @param retrieveCachedSharedSecret Optional function to retrieve shared secrets from the cache
     * @returns The derived child key.
     */
    deriveChild(publicKey, invoiceNumber, cacheSharedSecret, retrieveCachedSharedSecret) {
      let sharedSecret;
      if (typeof retrieveCachedSharedSecret === "function") {
        const retrieved = retrieveCachedSharedSecret(this, publicKey);
        if (retrieved === void 0) {
          sharedSecret = this.deriveSharedSecret(publicKey);
          if (typeof cacheSharedSecret === "function") {
            cacheSharedSecret(this, publicKey, sharedSecret);
          }
        } else {
          sharedSecret = retrieved;
        }
      } else {
        sharedSecret = this.deriveSharedSecret(publicKey);
      }
      const invoiceNumberBin = toArray2(invoiceNumber, "utf8");
      const hmac2 = sha256hmac(sharedSecret.encode(true), invoiceNumberBin);
      const curve2 = new Curve();
      return new _PrivateKey(this.add(new BigNumber(hmac2)).mod(curve2.n).toArray());
    }
    /**
     * Splits the private key into shares using Shamir's Secret Sharing Scheme.
     *
     * @param threshold The minimum number of shares required to reconstruct the private key.
     * @param totalShares The total number of shares to generate.
     * @param prime The prime number to be used in Shamir's Secret Sharing Scheme.
     * @returns An array of shares.
     *
     * @example
     * const key = PrivateKey.fromRandom()
     * const shares = key.toKeyShares(2, 5)
     */
    toKeyShares(threshold, totalShares) {
      if (typeof threshold !== "number" || typeof totalShares !== "number") {
        throw new TypeError("threshold and totalShares must be numbers");
      }
      if (threshold < 2)
        throw new Error("threshold must be at least 2");
      if (totalShares < 2)
        throw new Error("totalShares must be at least 2");
      if (threshold > totalShares) {
        throw new Error("threshold should be less than or equal to totalShares");
      }
      const poly = Polynomial.fromPrivateKey(this, threshold);
      const points = [];
      const usedXCoordinates = /* @__PURE__ */ new Set();
      const curve2 = new Curve();
      const seed = Random_default(64);
      for (let i = 0; i < totalShares; i++) {
        let x;
        let attempts = 0;
        do {
          const counter = [i, attempts, ...Random_default(32)];
          const h = sha512hmac(seed, counter);
          x = new BigNumber(h).umod(curve2.p);
          attempts++;
          if (attempts > 5) {
            throw new Error("Failed to generate unique x coordinate after 5 attempts");
          }
        } while (x.isZero() || usedXCoordinates.has(x.toString()));
        usedXCoordinates.add(x.toString());
        const y = poly.valueAt(x);
        points.push(new PointInFiniteField(x, y));
      }
      const integrity = this.toPublicKey().toHash("hex").slice(0, 8);
      return new KeyShares(points, threshold, integrity);
    }
    /**
     * @method toBackupShares
     *
     * Creates a backup of the private key by splitting it into shares.
     *
     *
     * @param threshold The number of shares which will be required to reconstruct the private key.
     * @param totalShares The number of shares to generate for distribution.
     * @returns
     */
    toBackupShares(threshold, totalShares) {
      return this.toKeyShares(threshold, totalShares).toBackupFormat();
    }
    /**
     *
     * @method fromBackupShares
     *
     * Creates a private key from backup shares.
     *
     * @param shares
     * @returns PrivateKey
     *
     * @example
     *
     * const share1 = '3znuzt7DZp8HzZTfTh5MF9YQKNX3oSxTbSYmSRGrH2ev.2Nm17qoocmoAhBTCs8TEBxNXCskV9N41rB2PckcgYeqV.2.35449bb9'
     * const share2 = 'Cm5fuUc39X5xgdedao8Pr1kvCSm8Gk7Cfenc7xUKcfLX.2juyK9BxCWn2DiY5JUAgj9NsQ77cc9bWksFyW45haXZm.2.35449bb9'
     *
     * const recoveredKey = PrivateKey.fromBackupShares([share1, share2])
     */
    static fromBackupShares(shares) {
      return _PrivateKey.fromKeyShares(KeyShares.fromBackupFormat(shares));
    }
    /**
     * Combines shares to reconstruct the private key.
     *
     * @param shares An array of points (shares) to be used to reconstruct the private key.
     * @param threshold The minimum number of shares required to reconstruct the private key.
     *
     * @returns The reconstructed private key.
     *
     **/
    static fromKeyShares(keyShares) {
      const { points, threshold, integrity } = keyShares;
      if (threshold < 2)
        throw new Error("threshold must be at least 2");
      if (points.length < threshold) {
        throw new Error(`At least ${threshold} shares are required to reconstruct the private key`);
      }
      for (let i = 0; i < threshold; i++) {
        for (let j = i + 1; j < threshold; j++) {
          if (points[i].x.eq(points[j].x)) {
            throw new Error("Duplicate share detected, each must be unique.");
          }
        }
      }
      const poly = new Polynomial(points, threshold);
      const privateKey = new _PrivateKey(poly.valueAt(new BigNumber(0)).toArray());
      const integrityHash = privateKey.toPublicKey().toHash("hex").slice(0, 8);
      if (integrityHash !== integrity) {
        throw new Error("Integrity hash mismatch");
      }
      return privateKey;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/AESGCM.js
  var SBox = new Uint8Array([
    99,
    124,
    119,
    123,
    242,
    107,
    111,
    197,
    48,
    1,
    103,
    43,
    254,
    215,
    171,
    118,
    202,
    130,
    201,
    125,
    250,
    89,
    71,
    240,
    173,
    212,
    162,
    175,
    156,
    164,
    114,
    192,
    183,
    253,
    147,
    38,
    54,
    63,
    247,
    204,
    52,
    165,
    229,
    241,
    113,
    216,
    49,
    21,
    4,
    199,
    35,
    195,
    24,
    150,
    5,
    154,
    7,
    18,
    128,
    226,
    235,
    39,
    178,
    117,
    9,
    131,
    44,
    26,
    27,
    110,
    90,
    160,
    82,
    59,
    214,
    179,
    41,
    227,
    47,
    132,
    83,
    209,
    0,
    237,
    32,
    252,
    177,
    91,
    106,
    203,
    190,
    57,
    74,
    76,
    88,
    207,
    208,
    239,
    170,
    251,
    67,
    77,
    51,
    133,
    69,
    249,
    2,
    127,
    80,
    60,
    159,
    168,
    81,
    163,
    64,
    143,
    146,
    157,
    56,
    245,
    188,
    182,
    218,
    33,
    16,
    255,
    243,
    210,
    205,
    12,
    19,
    236,
    95,
    151,
    68,
    23,
    196,
    167,
    126,
    61,
    100,
    93,
    25,
    115,
    96,
    129,
    79,
    220,
    34,
    42,
    144,
    136,
    70,
    238,
    184,
    20,
    222,
    94,
    11,
    219,
    224,
    50,
    58,
    10,
    73,
    6,
    36,
    92,
    194,
    211,
    172,
    98,
    145,
    149,
    228,
    121,
    231,
    200,
    55,
    109,
    141,
    213,
    78,
    169,
    108,
    86,
    244,
    234,
    101,
    122,
    174,
    8,
    186,
    120,
    37,
    46,
    28,
    166,
    180,
    198,
    232,
    221,
    116,
    31,
    75,
    189,
    139,
    138,
    112,
    62,
    181,
    102,
    72,
    3,
    246,
    14,
    97,
    53,
    87,
    185,
    134,
    193,
    29,
    158,
    225,
    248,
    152,
    17,
    105,
    217,
    142,
    148,
    155,
    30,
    135,
    233,
    206,
    85,
    40,
    223,
    140,
    161,
    137,
    13,
    191,
    230,
    66,
    104,
    65,
    153,
    45,
    15,
    176,
    84,
    187,
    22
  ]);
  var Rcon = [
    [0, 0, 0, 0],
    [1, 0, 0, 0],
    [2, 0, 0, 0],
    [4, 0, 0, 0],
    [8, 0, 0, 0],
    [16, 0, 0, 0],
    [32, 0, 0, 0],
    [64, 0, 0, 0],
    [128, 0, 0, 0],
    [27, 0, 0, 0],
    [54, 0, 0, 0]
  ].map((v) => new Uint8Array(v));
  var mul2 = new Uint8Array(256);
  var mul3 = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const m2 = (i << 1 ^ ((i & 128) === 0 ? 0 : 27)) & 255;
    mul2[i] = m2;
    mul3[i] = m2 ^ i;
  }
  function mixColumnsFast(state) {
    for (let c = 0; c < 4; c++) {
      const s0 = state[0][c];
      const s1 = state[1][c];
      const s2 = state[2][c];
      const s3 = state[3][c];
      state[0][c] = mul2[s0] ^ mul3[s1] ^ s2 ^ s3;
      state[1][c] = s0 ^ mul2[s1] ^ mul3[s2] ^ s3;
      state[2][c] = s0 ^ s1 ^ mul2[s2] ^ mul3[s3];
      state[3][c] = mul3[s0] ^ s1 ^ s2 ^ mul2[s3];
    }
  }
  function addRoundKey(state, roundKeyArray, offset) {
    for (let c = 0; c < 4; c++) {
      const keyCol = roundKeyArray[offset + c];
      for (let r2 = 0; r2 < 4; r2++) {
        state[r2][c] ^= keyCol[r2];
      }
    }
  }
  function subBytes(state) {
    for (let r2 = 0; r2 < 4; r2++) {
      for (let c = 0; c < 4; c++) {
        state[r2][c] = SBox[state[r2][c]];
      }
    }
  }
  function subWord(value) {
    for (let i = 0; i < 4; i++) {
      value[i] = SBox[value[i]];
    }
  }
  function rotWord(value) {
    const temp = value[0];
    value[0] = value[1];
    value[1] = value[2];
    value[2] = value[3];
    value[3] = temp;
  }
  function shiftRows(state) {
    let tmp = state[1][0];
    state[1][0] = state[1][1];
    state[1][1] = state[1][2];
    state[1][2] = state[1][3];
    state[1][3] = tmp;
    tmp = state[2][0];
    const tmp2 = state[2][1];
    state[2][0] = state[2][2];
    state[2][1] = state[2][3];
    state[2][2] = tmp;
    state[2][3] = tmp2;
    tmp = state[3][3];
    state[3][3] = state[3][2];
    state[3][2] = state[3][1];
    state[3][1] = state[3][0];
    state[3][0] = tmp;
  }
  function keyExpansion(roundLimit, key2) {
    const nK = key2.length / 4;
    const result = [];
    for (let i = 0; i < key2.length; i++) {
      if (i % 4 === 0)
        result.push([]);
      result[i >> 2].push(key2[i]);
    }
    for (let i = nK; i < 4 * roundLimit; i++) {
      result[i] = [];
      const temp = result[i - 1].slice();
      if (i % nK === 0) {
        rotWord(temp);
        subWord(temp);
        const r2 = Rcon[i / nK];
        for (let j = 0; j < 4; j++) {
          temp[j] ^= r2[j];
        }
      } else if (nK > 6 && i % nK === 4) {
        subWord(temp);
      }
      for (let j = 0; j < 4; j++) {
        result[i][j] = result[i - nK][j] ^ temp[j];
      }
    }
    return result;
  }
  function AES(input, key2) {
    let i;
    let j;
    let round;
    let roundLimit;
    const state = [[], [], [], []];
    const output = [];
    const ekey = Array.from(key2);
    if (ekey.length === 16) {
      roundLimit = 11;
    } else if (ekey.length === 24) {
      roundLimit = 13;
    } else if (ekey.length === 32) {
      roundLimit = 15;
    } else {
      throw new Error("Illegal key length: " + String(ekey.length));
    }
    const w = keyExpansion(roundLimit, ekey);
    for (let c = 0; c < 4; c++) {
      state[0][c] = input[c * 4];
      state[1][c] = input[c * 4 + 1];
      state[2][c] = input[c * 4 + 2];
      state[3][c] = input[c * 4 + 3];
    }
    addRoundKey(state, w, 0);
    for (round = 1; round < roundLimit; round++) {
      subBytes(state);
      shiftRows(state);
      if (round + 1 < roundLimit) {
        mixColumnsFast(state);
      }
      addRoundKey(state, w, round * 4);
    }
    for (i = 0; i < 4; i++) {
      for (j = 0; j < 4; j++) {
        output.push(state[j][i]);
      }
    }
    return output;
  }
  var getBytes64 = function(numericValue) {
    if (numericValue < 0 || numericValue > Number.MAX_SAFE_INTEGER) {
      throw new Error("getBytes64: value out of range");
    }
    const hi = Math.floor(numericValue / 4294967296);
    const lo = numericValue >>> 0;
    return [
      hi >>> 24 & 255,
      hi >>> 16 & 255,
      hi >>> 8 & 255,
      hi & 255,
      lo >>> 24 & 255,
      lo >>> 16 & 255,
      lo >>> 8 & 255,
      lo & 255
    ];
  };
  var createZeroBlock = function(length) {
    return new Uint8Array(length);
  };
  var R = (() => {
    const r2 = new Uint8Array(16);
    r2[0] = 225;
    return r2;
  })();
  var concatBytes = (...arrays) => {
    let total = 0;
    for (const a of arrays)
      total += a.length;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const a of arrays) {
      out.set(a, offset);
      offset += a.length;
    }
    return out;
  };
  var rightShift = function(block) {
    let carry = 0;
    let oldCarry = 0;
    for (let i = 0; i < block.length; i++) {
      oldCarry = carry;
      carry = block[i] & 1;
      block[i] = block[i] >> 1;
      if (oldCarry !== 0) {
        block[i] = block[i] | 128;
      }
    }
    return block;
  };
  var multiply = function(block0, block1) {
    const v = block1.slice();
    const z = createZeroBlock(16);
    for (let i = 0; i < 16; i++) {
      const b = block0[i];
      for (let j = 7; j >= 0; j--) {
        const bit = b >> j & 1;
        const mask = -bit & 255;
        for (let k = 0; k < 16; k++) {
          z[k] ^= v[k] & mask;
        }
        const lsb = v[15] & 1;
        const rmask = -lsb & 255;
        rightShift(v);
        for (let k = 0; k < 16; k++) {
          v[k] ^= R[k] & rmask;
        }
      }
    }
    return z;
  };
  var incrementLeastSignificantThirtyTwoBits = function(block) {
    const result = block.slice();
    for (let i = 15; i > 11; i--) {
      result[i] = result[i] + 1 & 255;
      if (result[i] !== 0) {
        break;
      }
    }
    return result;
  };
  function ghash(input, hashSubKey) {
    let result = createZeroBlock(16);
    const block = new Uint8Array(16);
    for (let i = 0; i < input.length; i += 16) {
      block.set(result);
      for (let j = 0; j < 16; j++) {
        block[j] ^= input[i + j] ?? 0;
      }
      result = multiply(block, hashSubKey);
    }
    return result;
  }
  function gctr(input, initialCounterBlock, key2) {
    if (input.length === 0)
      return new Uint8Array(0);
    const output = new Uint8Array(input.length);
    let counterBlock = initialCounterBlock.slice();
    let pos = 0;
    const n = Math.ceil(input.length / 16);
    for (let i = 0; i < n; i++) {
      const counter = AES(counterBlock, key2);
      const chunk = Math.min(16, input.length - pos);
      for (let j = 0; j < chunk; j++) {
        output[pos] = input[pos] ^ counter[j];
        pos++;
      }
      if (i + 1 < n) {
        counterBlock = incrementLeastSignificantThirtyTwoBits(counterBlock);
      }
    }
    return output;
  }
  function buildAuthInput(cipherText) {
    const aadLenBits = 0;
    const ctLenBits = cipherText.length * 8;
    let padLen;
    if (cipherText.length === 0) {
      padLen = 16;
    } else if (cipherText.length % 16 === 0) {
      padLen = 0;
    } else {
      padLen = 16 - cipherText.length % 16;
    }
    const total = 16 + cipherText.length + padLen + 16;
    const out = new Uint8Array(total);
    let offset = 0;
    offset += 16;
    out.set(cipherText, offset);
    offset += cipherText.length;
    offset += padLen;
    const aadLen = getBytes64(aadLenBits);
    out.set(aadLen, offset);
    offset += 8;
    const ctLen = getBytes64(ctLenBits);
    out.set(ctLen, offset);
    return out;
  }
  function AESGCM(plainText, initializationVector, key2) {
    if (initializationVector.length === 0) {
      throw new Error("Initialization vector must not be empty");
    }
    if (key2.length === 0) {
      throw new Error("Key must not be empty");
    }
    const hashSubKey = new Uint8Array(AES(createZeroBlock(16), key2));
    let preCounterBlock;
    if (initializationVector.length === 12) {
      preCounterBlock = concatBytes(initializationVector, createZeroBlock(3), new Uint8Array([1]));
    } else {
      let ivPadded = initializationVector;
      if (ivPadded.length % 16 !== 0) {
        ivPadded = concatBytes(ivPadded, createZeroBlock(16 - ivPadded.length % 16));
      }
      const lenBlock = getBytes64(initializationVector.length * 8);
      const s3 = concatBytes(ivPadded, createZeroBlock(8), new Uint8Array(lenBlock));
      preCounterBlock = ghash(s3, hashSubKey);
    }
    const cipherText = gctr(plainText, incrementLeastSignificantThirtyTwoBits(preCounterBlock), key2);
    const authInput = buildAuthInput(cipherText);
    const s2 = ghash(authInput, hashSubKey);
    const authenticationTag = gctr(s2, preCounterBlock, key2);
    return {
      result: cipherText,
      authenticationTag
    };
  }
  function AESGCMDecrypt(cipherText, initializationVector, authenticationTag, key2) {
    if (cipherText.length === 0) {
      throw new Error("Cipher text must not be empty");
    }
    if (initializationVector.length === 0) {
      throw new Error("Initialization vector must not be empty");
    }
    if (key2.length === 0) {
      throw new Error("Key must not be empty");
    }
    const hashSubKey = new Uint8Array(AES(createZeroBlock(16), key2));
    let preCounterBlock;
    if (initializationVector.length === 12) {
      preCounterBlock = concatBytes(initializationVector, createZeroBlock(3), new Uint8Array([1]));
    } else {
      let ivPadded = initializationVector;
      if (ivPadded.length % 16 !== 0) {
        ivPadded = concatBytes(ivPadded, createZeroBlock(16 - ivPadded.length % 16));
      }
      const lenBlock = getBytes64(initializationVector.length * 8);
      const s3 = concatBytes(ivPadded, createZeroBlock(8), new Uint8Array(lenBlock));
      preCounterBlock = ghash(s3, hashSubKey);
    }
    const plainText = gctr(cipherText, incrementLeastSignificantThirtyTwoBits(preCounterBlock), key2);
    const authInput = buildAuthInput(cipherText);
    const s2 = ghash(authInput, hashSubKey);
    const calculatedTag = gctr(s2, preCounterBlock, key2);
    if (calculatedTag.length !== authenticationTag.length) {
      return null;
    }
    let diff = 0;
    for (let i = 0; i < calculatedTag.length; i++) {
      diff |= calculatedTag[i] ^ authenticationTag[i];
    }
    if (diff !== 0) {
      return null;
    }
    return plainText;
  }

  // node_modules/@bsv/sdk/dist/esm/src/primitives/SymmetricKey.js
  var NODE_CRYPTO_SYM = (() => {
    const processLike = typeof globalThis === "undefined" ? void 0 : globalThis.process;
    const getBuiltinModule = processLike?.getBuiltinModule;
    if (typeof getBuiltinModule === "function") {
      try {
        const crypto = getBuiltinModule.call(processLike, "node:crypto");
        if (crypto != null)
          return crypto;
      } catch {
      }
    }
    try {
      if (typeof __require === "function") {
        return __require("node:crypto");
      }
    } catch {
    }
    return void 0;
  })();
  var NATIVE_AES_GCM_AVAILABLE = (() => {
    if (NODE_CRYPTO_SYM == null)
      return false;
    return typeof NODE_CRYPTO_SYM.createCipheriv === "function" && typeof NODE_CRYPTO_SYM.createDecipheriv === "function";
  })();
  function nativeEncrypt(plaintext, iv, key2) {
    try {
      const cipher = NODE_CRYPTO_SYM.createCipheriv("aes-256-gcm", Buffer.from(key2.buffer, key2.byteOffset, key2.byteLength), Buffer.from(iv.buffer, iv.byteOffset, iv.byteLength));
      const encrypted = Buffer.concat([
        cipher.update(Buffer.from(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength)),
        cipher.final()
      ]);
      const authTag = cipher.getAuthTag();
      const out = new Uint8Array(iv.length + encrypted.length + authTag.length);
      let offset = 0;
      out.set(iv, offset);
      offset += iv.length;
      out.set(encrypted, offset);
      offset += encrypted.length;
      out.set(authTag, offset);
      return out;
    } catch {
      return null;
    }
  }
  function nativeDecrypt(msgBytes, ivLength, tagLength, key2) {
    try {
      const iv = msgBytes.slice(0, ivLength);
      const tagStart = msgBytes.length - tagLength;
      const ciphertext = msgBytes.slice(ivLength, tagStart);
      const messageTag = msgBytes.slice(tagStart);
      const decipher = NODE_CRYPTO_SYM.createDecipheriv("aes-256-gcm", Buffer.from(key2.buffer, key2.byteOffset, key2.byteLength), Buffer.from(iv.buffer, iv.byteOffset, iv.byteLength));
      decipher.setAuthTag(Buffer.from(messageTag.buffer, messageTag.byteOffset, messageTag.byteLength));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(ciphertext.buffer, ciphertext.byteOffset, ciphertext.byteLength)),
        decipher.final()
      ]);
      return new Uint8Array(decrypted.buffer, decrypted.byteOffset, decrypted.byteLength);
    } catch {
      return null;
    }
  }
  var SymmetricKey = class _SymmetricKey extends BigNumber {
    /**
     * Generates a symmetric key randomly.
     *
     * @method fromRandom
     * @static
     * @returns The newly generated Symmetric Key.
     *
     * @example
     * const symmetricKey = SymmetricKey.fromRandom();
     */
    static fromRandom() {
      return new _SymmetricKey(Random_default(32));
    }
    /**
     * Encrypts a given message using AES-GCM encryption.
     * The generated Initialization Vector (IV) is attached to the encrypted message for decryption purposes.
     * The OpenSSL format of |IV|encryptedContent|authTag| is used.
     *
     * @method encrypt
     * @param msg - The message to be encrypted. It can be a string or an array of numbers.
     * @param enc - optional. The encoding of the message. If hex, the string is assumed to be hex, UTF-8 otherwise.
     * @returns Returns the encrypted message as a string or an array of numbers, depending on `enc` argument.
     *
     * @example
     * const key = new SymmetricKey(1234);
     * const encryptedMessage = key.encrypt('plainText', 'utf8');
     */
    encrypt(msg, enc) {
      const iv = new Uint8Array(Random_default(32));
      const msgBytes = new Uint8Array(toArray2(msg, enc));
      const keyBytes = new Uint8Array(this.toArray("be", 32));
      if (NATIVE_AES_GCM_AVAILABLE) {
        const nativeResult = nativeEncrypt(msgBytes, iv, keyBytes);
        if (nativeResult !== null) {
          return encode(Array.from(nativeResult), enc);
        }
      }
      const { result, authenticationTag } = AESGCM(msgBytes, iv, keyBytes);
      const totalLength = iv.length + result.length + authenticationTag.length;
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      combined.set(iv, offset);
      offset += iv.length;
      combined.set(result, offset);
      offset += result.length;
      combined.set(authenticationTag, offset);
      return encode(Array.from(combined), enc);
    }
    /**
     * Decrypts a given AES-GCM encrypted message using the same key that was used for encryption.
     * The method extracts the IV and the authentication tag from the encrypted message, then attempts to decrypt it.
     * If the decryption fails (e.g., due to message tampering), an error is thrown.
     *
     * @method decrypt
     * @param msg - The encrypted message to be decrypted. It can be a string or an array of numbers.
     * @param enc - optional. The encoding of the message (if no encoding is provided, uses utf8 for strings, unless specified as hex).
     * @returns Returns the decrypted message as a string or an array of numbers, depending on `enc` argument. If absent, an array of numbers is returned.
     *
     * @example
     * const key = new SymmetricKey(1234);
     * const decryptedMessage = key.decrypt(encryptedMessage, 'utf8');
     *
     * @throws {Error} Will throw an error if the decryption fails, likely due to message tampering or incorrect decryption key.
     */
    decrypt(msg, enc) {
      const msgBytes = new Uint8Array(toArray2(msg, enc));
      const ivLength = 32;
      const tagLength = 16;
      if (msgBytes.length < ivLength + tagLength) {
        throw new Error("Ciphertext too short");
      }
      const keyBytes = new Uint8Array(this.toArray("be", 32));
      if (NATIVE_AES_GCM_AVAILABLE) {
        const nativeResult = nativeDecrypt(msgBytes, ivLength, tagLength, keyBytes);
        if (nativeResult !== void 0) {
          if (nativeResult === null) {
            throw new Error("Decryption failed!");
          }
          return encode(Array.from(nativeResult), enc);
        }
      }
      const iv = msgBytes.slice(0, ivLength);
      const tagStart = msgBytes.length - tagLength;
      const ciphertext = msgBytes.slice(ivLength, tagStart);
      const messageTag = msgBytes.slice(tagStart);
      const result = AESGCMDecrypt(ciphertext, iv, messageTag, keyBytes);
      if (result === null) {
        throw new Error("Decryption failed!");
      }
      return encode(Array.from(result), enc);
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/script/OP.js
  var OP = {
    // push value
    OP_0: 0,
    // when two op codes have the same value, the top one will be used in standard ASM output
    OP_FALSE: 0,
    OP_PUSHDATA1: 76,
    OP_PUSHDATA2: 77,
    OP_PUSHDATA4: 78,
    OP_1NEGATE: 79,
    OP_RESERVED: 80,
    OP_1: 81,
    OP_TRUE: 81,
    OP_2: 82,
    OP_3: 83,
    OP_4: 84,
    OP_5: 85,
    OP_6: 86,
    OP_7: 87,
    OP_8: 88,
    OP_9: 89,
    OP_10: 90,
    OP_11: 91,
    OP_12: 92,
    OP_13: 93,
    OP_14: 94,
    OP_15: 95,
    OP_16: 96,
    // control
    OP_NOP: 97,
    OP_VER: 98,
    OP_IF: 99,
    OP_NOTIF: 100,
    OP_VERIF: 101,
    OP_VERNOTIF: 102,
    OP_ELSE: 103,
    OP_ENDIF: 104,
    OP_VERIFY: 105,
    OP_RETURN: 106,
    // stack ops
    OP_TOALTSTACK: 107,
    OP_FROMALTSTACK: 108,
    OP_2DROP: 109,
    OP_2DUP: 110,
    OP_3DUP: 111,
    OP_2OVER: 112,
    OP_2ROT: 113,
    OP_2SWAP: 114,
    OP_IFDUP: 115,
    OP_DEPTH: 116,
    OP_DROP: 117,
    OP_DUP: 118,
    OP_NIP: 119,
    OP_OVER: 120,
    OP_PICK: 121,
    OP_ROLL: 122,
    OP_ROT: 123,
    OP_SWAP: 124,
    OP_TUCK: 125,
    // data manipulation ops
    OP_CAT: 126,
    OP_SPLIT: 127,
    // after monolith upgrade (May 2018)
    OP_NUM2BIN: 128,
    // after monolith upgrade (May 2018)
    OP_BIN2NUM: 129,
    // after monolith upgrade (May 2018)
    OP_SIZE: 130,
    // bit logic
    OP_INVERT: 131,
    OP_AND: 132,
    OP_OR: 133,
    OP_XOR: 134,
    OP_EQUAL: 135,
    OP_EQUALVERIFY: 136,
    OP_RESERVED1: 137,
    OP_RESERVED2: 138,
    // numeric
    OP_1ADD: 139,
    OP_1SUB: 140,
    OP_2MUL: 141,
    OP_2DIV: 142,
    OP_NEGATE: 143,
    OP_ABS: 144,
    OP_NOT: 145,
    OP_0NOTEQUAL: 146,
    OP_ADD: 147,
    OP_SUB: 148,
    OP_MUL: 149,
    OP_DIV: 150,
    OP_MOD: 151,
    OP_LSHIFT: 152,
    OP_RSHIFT: 153,
    OP_BOOLAND: 154,
    OP_BOOLOR: 155,
    OP_NUMEQUAL: 156,
    OP_NUMEQUALVERIFY: 157,
    OP_NUMNOTEQUAL: 158,
    OP_LESSTHAN: 159,
    OP_GREATERTHAN: 160,
    OP_LESSTHANOREQUAL: 161,
    OP_GREATERTHANOREQUAL: 162,
    OP_MIN: 163,
    OP_MAX: 164,
    OP_WITHIN: 165,
    // crypto
    OP_RIPEMD160: 166,
    OP_SHA1: 167,
    OP_SHA256: 168,
    OP_HASH160: 169,
    OP_HASH256: 170,
    OP_CODESEPARATOR: 171,
    OP_CHECKSIG: 172,
    OP_CHECKSIGVERIFY: 173,
    OP_CHECKMULTISIG: 174,
    OP_CHECKMULTISIGVERIFY: 175,
    // expansion
    OP_NOP1: 176,
    OP_CHECKLOCKTIMEVERIFY: 177,
    // BIP65 - on BSV post-genesis acts as NOP
    OP_NOP2: 177,
    // alias for OP_CHECKLOCKTIMEVERIFY
    OP_CHECKSEQUENCEVERIFY: 178,
    // BIP112 - on BSV post-genesis acts as NOP
    OP_NOP3: 178,
    // alias for OP_CHECKSEQUENCEVERIFY
    OP_SUBSTR: 179,
    // restored in 2026 CHRONICLE upgrade (was OP_NOP4)
    OP_NOP4: 179,
    // alias for OP_SUBSTR
    OP_LEFT: 180,
    // restored in 2026 CHRONICLE upgrade (was OP_NOP5)
    OP_NOP5: 180,
    // alias for OP_LEFT
    OP_RIGHT: 181,
    // restored in 2026 CHRONICLE upgrade (was OP_NOP6)
    OP_NOP6: 181,
    // alias for OP_RIGHT
    OP_LSHIFTNUM: 182,
    // restored in 2026 CHRONICLE upgrade (was OP_NOP7)
    OP_NOP7: 182,
    // alias for OP_LSHIFTNUM
    OP_RSHIFTNUM: 183,
    // restored in 2026 CHRONICLE upgrade (was OP_NOP8)
    OP_NOP8: 183,
    // alias for OP_RSHIFTNUM
    OP_NOP9: 184,
    OP_NOP10: 185,
    // 0xba–0xf9 are FIRST_UNDEFINED_OP_VALUE in node v1.2.0 and return SCRIPT_ERR_BAD_OPCODE
    // when executed. The names below are retained for ASM parsing/serialisation only.
    OP_NOP11: 186,
    OP_NOP12: 187,
    OP_NOP13: 188,
    OP_NOP14: 189,
    OP_NOP15: 190,
    OP_NOP16: 191,
    OP_NOP17: 192,
    OP_NOP18: 193,
    OP_NOP19: 194,
    OP_NOP20: 195,
    OP_NOP21: 196,
    OP_NOP22: 197,
    OP_NOP23: 198,
    OP_NOP24: 199,
    OP_NOP25: 200,
    OP_NOP26: 201,
    OP_NOP27: 202,
    OP_NOP28: 203,
    OP_NOP29: 204,
    OP_NOP30: 205,
    OP_NOP31: 206,
    OP_NOP32: 207,
    OP_NOP33: 208,
    OP_NOP34: 209,
    OP_NOP35: 210,
    OP_NOP36: 211,
    OP_NOP37: 212,
    OP_NOP38: 213,
    OP_NOP39: 214,
    OP_NOP40: 215,
    OP_NOP41: 216,
    OP_NOP42: 217,
    OP_NOP43: 218,
    OP_NOP44: 219,
    OP_NOP45: 220,
    OP_NOP46: 221,
    OP_NOP47: 222,
    OP_NOP48: 223,
    OP_NOP49: 224,
    OP_NOP50: 225,
    OP_NOP51: 226,
    OP_NOP52: 227,
    OP_NOP53: 228,
    OP_NOP54: 229,
    OP_NOP55: 230,
    OP_NOP56: 231,
    OP_NOP57: 232,
    OP_NOP58: 233,
    OP_NOP59: 234,
    OP_NOP60: 235,
    OP_NOP61: 236,
    OP_NOP62: 237,
    OP_NOP63: 238,
    OP_NOP64: 239,
    OP_NOP65: 240,
    OP_NOP66: 241,
    OP_NOP67: 242,
    OP_NOP68: 243,
    OP_NOP69: 244,
    OP_NOP70: 245,
    OP_NOP71: 246,
    OP_NOP72: 247,
    OP_NOP73: 248,
    OP_NOP77: 252,
    // template matching params (not executable opcodes; 0xf9 was removed from node v1.2.0 opcodes.h
    // but retained here for ASM round-trip compatibility)
    OP_SMALLDATA: 249,
    OP_SMALLINTEGER: 250,
    OP_PUBKEYS: 251,
    OP_PUBKEYHASH: 253,
    OP_PUBKEY: 254,
    OP_INVALIDOPCODE: 255
  };
  for (const name in OP) {
    if (OP[OP[name]] === void 0)
      OP[OP[name]] = name;
  }
  var OP_default = OP;

  // node_modules/@bsv/sdk/dist/esm/src/script/Script.js
  var BufferCtor4 = typeof globalThis === "undefined" ? void 0 : globalThis.Buffer;
  var Script = class _Script {
    /**
     * @constructor
     * Constructs a new Script object.
     * @param chunks=[] - An array of script chunks to directly initialize the script.
     * @param rawBytesCache - Optional serialized bytes that can be reused instead of reserializing `chunks`.
     * @param hexCache - Optional lowercase hex string that matches the serialized bytes, used to satisfy `toHex` quickly.
     * @param parsed - When false the script defers parsing `rawBytesCache` until `chunks` is accessed; defaults to true.
     */
    constructor(chunks = [], rawBytesCache, hexCache, parsed = true) {
      __publicField(this, "_chunks");
      __publicField(this, "parsed");
      __publicField(this, "rawBytesCache");
      __publicField(this, "hexCache");
      this._chunks = chunks;
      this.parsed = parsed;
      this.rawBytesCache = rawBytesCache;
      this.hexCache = hexCache;
    }
    /**
     * @method fromASM
     * Static method to construct a Script instance from an ASM (Assembly) formatted string.
     * @param asm - The script in ASM string format.
     * @returns A new Script instance.
     * @example
     * const script = Script.fromASM("OP_DUP OP_HASH160 abcd... OP_EQUALVERIFY OP_CHECKSIG")
     */
    static fromASM(asm) {
      const chunks = [];
      const tokens = asm.split(" ");
      let i = 0;
      while (i < tokens.length) {
        const { chunk, advance } = _Script.parseASMToken(tokens, i);
        chunks.push(chunk);
        i += advance;
      }
      return new _Script(chunks);
    }
    static pushdataOpCodeNum(len) {
      if (len >= 0 && len < OP_default.OP_PUSHDATA1)
        return len;
      if (len < Math.pow(2, 8))
        return OP_default.OP_PUSHDATA1;
      if (len < Math.pow(2, 16))
        return OP_default.OP_PUSHDATA2;
      return OP_default.OP_PUSHDATA4;
    }
    static parseASMToken(tokens, i) {
      const token = tokens[i];
      if (token === "0")
        return { chunk: { op: 0 }, advance: 1 };
      if (token === "-1")
        return { chunk: { op: OP_default.OP_1NEGATE }, advance: 1 };
      const isKnownOp = token.startsWith("OP_") && OP_default[token] !== void 0;
      const opCodeNum = isKnownOp ? OP_default[token] : 0;
      if (opCodeNum === OP_default.OP_PUSHDATA1 || opCodeNum === OP_default.OP_PUSHDATA2 || opCodeNum === OP_default.OP_PUSHDATA4) {
        return { chunk: { data: toArray2(tokens[i + 2], "hex"), op: opCodeNum }, advance: 3 };
      }
      if (!isKnownOp) {
        let hex = token;
        if (hex.length % 2 !== 0)
          hex = "0" + hex;
        const arr = toArray2(hex, "hex");
        if (encode(arr, "hex") !== hex) {
          throw new Error("invalid hex string in script");
        }
        return { chunk: { data: arr, op: _Script.pushdataOpCodeNum(arr.length) }, advance: 1 };
      }
      return { chunk: { op: opCodeNum }, advance: 1 };
    }
    /**
     * @method fromHex
     * Static method to construct a Script instance from a hexadecimal string.
     * @param hex - The script in hexadecimal format.
     * @returns A new Script instance.
     * @example
     * const script = Script.fromHex("76a9...");
     */
    static fromHex(hex) {
      if (hex.length === 0)
        return _Script.fromBinary([]);
      if (hex.length % 2 !== 0) {
        throw new Error("There is an uneven number of characters in the string which suggests it is not hex encoded.");
      }
      if (!/^[0-9a-fA-F]+$/.test(hex)) {
        throw new Error("Some elements in this string are not hex encoded.");
      }
      const bin = toArray2(hex, "hex");
      const rawBytes = Uint8Array.from(bin);
      return new _Script([], rawBytes, hex.toLowerCase(), false);
    }
    /**
     * @method fromBinary
     * Static method to construct a Script instance from a binary array.
     * @param bin - The script in binary array format.
     * @returns A new Script instance.
     * @example
     * const script = Script.fromBinary([0x76, 0xa9, ...])
     */
    static fromBinary(bin) {
      const rawBytes = Uint8Array.from(bin);
      return new _Script([], rawBytes, void 0, false);
    }
    get chunks() {
      this.ensureParsed();
      return this._chunks;
    }
    set chunks(value) {
      this._chunks = value;
      this.parsed = true;
      this.invalidateSerializationCaches();
    }
    ensureParsed() {
      if (this.parsed)
        return;
      if (this.rawBytesCache != null) {
        this._chunks = _Script.parseChunks(this.rawBytesCache);
      } else {
        this._chunks = [];
      }
      this.parsed = true;
    }
    /**
     * @method toASM
     * Serializes the script to an ASM formatted string.
     * @returns The script in ASM string format.
     */
    toASM() {
      let str = "";
      for (const chunk of this.chunks) {
        str += this._chunkToString(chunk);
      }
      return str.slice(1);
    }
    /**
     * @method toHex
     * Serializes the script to a hexadecimal string.
     * @returns The script in hexadecimal format.
     */
    toHex() {
      if (this.hexCache != null) {
        return this.hexCache;
      }
      this.rawBytesCache ?? (this.rawBytesCache = this.serializeChunksToBytes());
      const hex = BufferCtor4 == null ? encode(Array.from(this.rawBytesCache), "hex") : BufferCtor4.from(this.rawBytesCache).toString("hex");
      this.hexCache = hex;
      return hex;
    }
    /**
     * @method toBinary
     * Serializes the script to a binary array.
     * @returns The script in binary array format.
     */
    toBinary() {
      return Array.from(this.toUint8Array());
    }
    toUint8Array() {
      this.rawBytesCache ?? (this.rawBytesCache = this.serializeChunksToBytes());
      return this.rawBytesCache;
    }
    /**
     * @method writeScript
     * Appends another script to this script.
     * @param script - The script to append.
     * @returns This script instance for chaining.
     */
    writeScript(script) {
      this.invalidateSerializationCaches();
      this.chunks = this.chunks.concat(script.chunks);
      return this;
    }
    /**
     * @method writeOpCode
     * Appends an opcode to the script.
     * @param op - The opcode to append.
     * @returns This script instance for chaining.
     */
    writeOpCode(op3) {
      this.invalidateSerializationCaches();
      this.chunks.push({ op: op3 });
      return this;
    }
    /**
     * @method setChunkOpCode
     * Sets the opcode of a specific chunk in the script.
     * @param i - The index of the chunk.
     * @param op - The opcode to set.
     * @returns This script instance for chaining.
     */
    setChunkOpCode(i, op3) {
      this.invalidateSerializationCaches();
      this.chunks[i] = { op: op3 };
      return this;
    }
    /**
     * @method writeBn
     * Appends a BigNumber to the script as an opcode.
     * @param bn - The BigNumber to append.
     * @returns This script instance for chaining.
     */
    writeBn(bn) {
      this.invalidateSerializationCaches();
      if (bn.cmpn(0) === OP_default.OP_0) {
        this.chunks.push({
          op: OP_default.OP_0
        });
      } else if (bn.cmpn(-1) === 0) {
        this.chunks.push({
          op: OP_default.OP_1NEGATE
        });
      } else if (bn.cmpn(1) >= 0 && bn.cmpn(16) <= 0) {
        this.chunks.push({
          op: bn.toNumber() + OP_default.OP_1 - 1
        });
      } else {
        const buf = bn.toSm("little");
        this.writeBin(buf);
      }
      return this;
    }
    /**
     * @method writeBin
     * Appends binary data to the script, determining the appropriate opcode based on length.
     * @param bin - The binary data to append.
     * @returns This script instance for chaining.
     * @throws {Error} Throws an error if the data is too large to be pushed.
     */
    writeBin(bin) {
      this.invalidateSerializationCaches();
      let op3;
      const data = bin.length > 0 ? bin : void 0;
      if (bin.length > 0 && bin.length < OP_default.OP_PUSHDATA1) {
        op3 = bin.length;
      } else if (bin.length === 0) {
        op3 = OP_default.OP_0;
      } else if (bin.length < Math.pow(2, 8)) {
        op3 = OP_default.OP_PUSHDATA1;
      } else if (bin.length < Math.pow(2, 16)) {
        op3 = OP_default.OP_PUSHDATA2;
      } else if (bin.length < Math.pow(2, 32)) {
        op3 = OP_default.OP_PUSHDATA4;
      } else {
        throw new Error("You can't push that much data");
      }
      this.chunks.push({
        data,
        op: op3
      });
      return this;
    }
    /**
     * @method writeNumber
     * Appends a number to the script.
     * @param num - The number to append.
     * @returns This script instance for chaining.
     */
    writeNumber(num) {
      this.invalidateSerializationCaches();
      this.writeBn(new BigNumber(num));
      return this;
    }
    /**
     * @method removeCodeseparators
     * Removes all OP_CODESEPARATOR opcodes from the script.
     * @returns This script instance for chaining.
     */
    removeCodeseparators() {
      const bytes2 = this.toUint8Array();
      this.rawBytesCache = Uint8Array.from(_Script.removeOpcodeBytes(bytes2, OP_default.OP_CODESEPARATOR));
      this.hexCache = void 0;
      this._chunks = [];
      this.parsed = false;
      return this;
    }
    /**
     * Deletes the given item wherever it appears in the current script.
     *
     * @param script - The script containing the item to delete from the current script.
     *
     * @returns This script instance for chaining.
     */
    findAndDelete(script) {
      this.invalidateSerializationCaches();
      const targetBytes = script.toUint8Array();
      const targetLen = targetBytes.length;
      if (targetLen === 0)
        return this;
      const targetOp = targetBytes[0] ?? 0;
      const matchesChunk = (chunk) => {
        if (chunk.op !== targetOp)
          return false;
        const dataArr = chunk.data ?? [];
        const dataLen = dataArr.length;
        if (dataLen === 0) {
          return targetLen === 1;
        }
        if (chunk.op === OP_default.OP_RETURN) {
          if (targetLen !== 1 + dataLen)
            return false;
          for (let j = 0; j < dataLen; j++) {
            if (targetBytes[1 + j] !== dataArr[j])
              return false;
          }
          return true;
        }
        if (chunk.op < OP_default.OP_PUSHDATA1) {
          if (targetLen !== 1 + dataLen)
            return false;
          for (let j = 0; j < dataLen; j++) {
            if (targetBytes[1 + j] !== dataArr[j])
              return false;
          }
          return true;
        }
        if (chunk.op === OP_default.OP_PUSHDATA1) {
          if (targetLen !== 2 + dataLen)
            return false;
          if (targetBytes[1] !== (dataLen & 255))
            return false;
          for (let j = 0; j < dataLen; j++) {
            if (targetBytes[2 + j] !== dataArr[j])
              return false;
          }
          return true;
        }
        if (chunk.op === OP_default.OP_PUSHDATA2) {
          if (targetLen !== 3 + dataLen)
            return false;
          if (targetBytes[1] !== (dataLen & 255))
            return false;
          if (targetBytes[2] !== (dataLen >> 8 & 255))
            return false;
          for (let j = 0; j < dataLen; j++) {
            if (targetBytes[3 + j] !== dataArr[j])
              return false;
          }
          return true;
        }
        if (chunk.op === OP_default.OP_PUSHDATA4) {
          if (targetLen !== 5 + dataLen)
            return false;
          const size = dataLen >>> 0;
          if (targetBytes[1] !== (size & 255))
            return false;
          if (targetBytes[2] !== (size >> 8 & 255))
            return false;
          if (targetBytes[3] !== (size >> 16 & 255))
            return false;
          if (targetBytes[4] !== (size >> 24 & 255))
            return false;
          for (let j = 0; j < dataLen; j++) {
            if (targetBytes[5 + j] !== dataArr[j])
              return false;
          }
          return true;
        }
        return false;
      };
      for (let i = 0; i < this.chunks.length; ) {
        if (matchesChunk(this.chunks[i])) {
          this.chunks.splice(i, 1);
        } else {
          i++;
        }
      }
      return this;
    }
    /**
     * @method isPushOnly
     * Checks if the script contains only push data operations.
     * @returns True if the script is push-only, otherwise false.
     */
    isPushOnly() {
      for (const chunk of this.chunks) {
        const opCodeNum = chunk.op;
        if (opCodeNum > OP_default.OP_16) {
          return false;
        }
      }
      return true;
    }
    /**
     * @method isLockingScript
     * Determines if the script is a locking script.
     * @returns True if the script is a locking script, otherwise false.
     */
    isLockingScript() {
      throw new Error("Not implemented");
    }
    /**
     * @method isUnlockingScript
     * Determines if the script is an unlocking script.
     * @returns True if the script is an unlocking script, otherwise false.
     */
    isUnlockingScript() {
      throw new Error("Not implemented");
    }
    /**
     * @private
     * @method _chunkToString
     * Converts a script chunk to its string representation.
     * @param chunk - The script chunk.
     * @returns The string representation of the chunk.
     */
    static computeSerializedLength(chunks) {
      let total = 0;
      for (const chunk of chunks) {
        total += 1;
        if (chunk.data == null)
          continue;
        const len = chunk.data.length;
        if (chunk.op === OP_default.OP_RETURN) {
          total += len;
          break;
        }
        if (chunk.op < OP_default.OP_PUSHDATA1) {
          total += len;
        } else if (chunk.op === OP_default.OP_PUSHDATA1) {
          total += 1 + len;
        } else if (chunk.op === OP_default.OP_PUSHDATA2) {
          total += 2 + len;
        } else if (chunk.op === OP_default.OP_PUSHDATA4) {
          total += 4 + len;
        }
      }
      return total;
    }
    serializeChunksToBytes() {
      const chunks = this.chunks;
      const totalLength = _Script.computeSerializedLength(chunks);
      const bytes2 = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        bytes2[offset++] = chunk.op;
        if (chunk.data == null)
          continue;
        if (chunk.op === OP_default.OP_RETURN) {
          bytes2.set(chunk.data, offset);
          break;
        }
        offset = _Script.writeChunkData(bytes2, offset, chunk.op, chunk.data);
      }
      return bytes2;
    }
    invalidateSerializationCaches() {
      this.rawBytesCache = void 0;
      this.hexCache = void 0;
    }
    static writeChunkData(target, offset, op3, data) {
      const len = data.length;
      if (op3 < OP_default.OP_PUSHDATA1) {
        target.set(data, offset);
        return offset + len;
      } else if (op3 === OP_default.OP_PUSHDATA1) {
        target[offset++] = len & 255;
        target.set(data, offset);
        return offset + len;
      } else if (op3 === OP_default.OP_PUSHDATA2) {
        target[offset++] = len & 255;
        target[offset++] = len >> 8 & 255;
        target.set(data, offset);
        return offset + len;
      } else if (op3 === OP_default.OP_PUSHDATA4) {
        const size = len >>> 0;
        target[offset++] = size & 255;
        target[offset++] = size >> 8 & 255;
        target[offset++] = size >> 16 & 255;
        target[offset++] = size >> 24 & 255;
        target.set(data, offset);
        return offset + len;
      }
      return offset;
    }
    /**
     * Reads pushdata length bytes from `bytes` at `pos` and returns the resulting
     * `{ len, newPos, hasLength }` for a given opcode. Does not read the actual data.
     */
    static readPushdataLength(op3, bytes2, pos, length) {
      if (op3 > 0 && op3 < OP_default.OP_PUSHDATA1) {
        return { len: op3, newPos: pos, hasLength: true };
      }
      if (op3 === OP_default.OP_PUSHDATA1) {
        const hasLength2 = pos < length;
        const len2 = hasLength2 ? bytes2[pos++] ?? 0 : 0;
        return { len: len2, newPos: pos, hasLength: hasLength2 };
      }
      if (op3 === OP_default.OP_PUSHDATA2) {
        const hasLength2 = pos + 1 < length;
        const len2 = (bytes2[pos] ?? 0) | (bytes2[pos + 1] ?? 0) << 8;
        return { len: len2, newPos: Math.min(pos + 2, length), hasLength: hasLength2 };
      }
      const hasLength = pos + 3 < length;
      const len = ((bytes2[pos] ?? 0) | (bytes2[pos + 1] ?? 0) << 8 | (bytes2[pos + 2] ?? 0) << 16 | (bytes2[pos + 3] ?? 0) << 24) >>> 0;
      return { len, newPos: Math.min(pos + 4, length), hasLength };
    }
    static parseChunks(bytes2) {
      const chunks = [];
      const length = bytes2.length;
      let pos = 0;
      let inConditionalBlock = 0;
      while (pos < length) {
        const op3 = bytes2[pos++] ?? 0;
        if (op3 === OP_default.OP_RETURN && inConditionalBlock === 0) {
          chunks.push({ op: op3, data: _Script.copyRange(bytes2, pos, length) });
          break;
        }
        if (op3 === OP_default.OP_IF || op3 === OP_default.OP_NOTIF || op3 === OP_default.OP_VERIF || op3 === OP_default.OP_VERNOTIF) {
          inConditionalBlock++;
        } else if (op3 === OP_default.OP_ENDIF) {
          inConditionalBlock--;
        }
        if (op3 > 0 && op3 <= OP_default.OP_PUSHDATA4) {
          const { len, newPos, hasLength } = _Script.readPushdataLength(op3, bytes2, pos, length);
          pos = newPos;
          const end = Math.min(pos + len, length);
          const invalidLength = !hasLength || end - pos !== len;
          chunks.push({ data: _Script.copyRange(bytes2, pos, end), op: op3, invalidLength });
          pos = end;
        } else {
          chunks.push({ op: op3 });
        }
      }
      return chunks;
    }
    static removeOpcodeBytes(bytes2, opcode) {
      const out = [];
      const length = bytes2.length;
      let pos = 0;
      while (pos < length) {
        const start = pos;
        const op3 = bytes2[pos++] ?? 0;
        if (op3 > 0 && op3 <= OP_default.OP_PUSHDATA4) {
          const { len, newPos } = _Script.readPushdataLength(op3, bytes2, pos, length);
          pos = newPos;
          const end = Math.min(pos + len, length);
          if (op3 !== opcode) {
            for (let i = start; i < end; i++)
              out.push(bytes2[i] ?? 0);
          }
          pos = end;
        } else if (op3 !== opcode) {
          out.push(op3);
        }
      }
      return out;
    }
    static copyRange(bytes2, start, end) {
      const size = Math.max(end - start, 0);
      const data = new Array(size);
      for (let i = 0; i < size; i++) {
        data[i] = bytes2[start + i] ?? 0;
      }
      return data;
    }
    _chunkToString(chunk) {
      const op3 = chunk.op;
      let str = "";
      if (chunk.data === void 0) {
        const val2 = OP_default[op3];
        str = `${str} ${val2}`;
      } else {
        str = `${str} ${toHex(chunk.data)}`;
      }
      return str;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/primitives/TransactionSignature.js
  var EMPTY_SCRIPT = new Uint8Array(0);
  var _TransactionSignature = class _TransactionSignature extends Signature {
    constructor(r2, s2, scope) {
      super(r2, s2);
      __publicField(this, "scope");
      this.scope = scope;
    }
    /**
     * Implements the original bitcoin transaction signature digest preimage algorithm (OTDA).
     * @param params
     * @returns preimage as a byte array
     */
    static formatOTDA(params) {
      const isAnyoneCanPay = (params.scope & _TransactionSignature.SIGHASH_ANYONECANPAY) === _TransactionSignature.SIGHASH_ANYONECANPAY;
      const isSingle = (params.scope & 31) === _TransactionSignature.SIGHASH_SINGLE;
      const isNone = (params.scope & 31) === _TransactionSignature.SIGHASH_NONE;
      const isAll = (params.scope & 31) === _TransactionSignature.SIGHASH_ALL || !isSingle && !isNone;
      const subscript = Script.fromBinary(params.subscript.toBinary());
      subscript.removeCodeseparators();
      const currentInput = {
        sourceTXID: params.sourceTXID,
        sourceOutputIndex: params.sourceOutputIndex,
        sequence: params.inputSequence,
        script: subscript.toBinary()
      };
      const writer = new Writer();
      function writeInputs(inputs) {
        writer.writeVarIntNum(inputs.length);
        for (const input of inputs) {
          writer.writeReverse(toArray2(input.sourceTXID, "hex"));
          writer.writeUInt32LE(input.sourceOutputIndex);
          writer.writeVarIntNum(input.script.length);
          writer.write(input.script);
          writer.writeUInt32LE(input.sequence);
        }
      }
      function writeOutputs(outputs) {
        writer.writeVarIntNum(outputs.length);
        for (const output of outputs) {
          writer.writeUInt64LE(output.satoshis);
          writer.writeVarIntNum(output.script.length);
          writer.write(output.script);
        }
      }
      writer.writeInt32LE(params.transactionVersion);
      const emptyScript = new Script().toBinary();
      if (!isAnyoneCanPay) {
        const inputs = params.otherInputs.map((input) => ({
          sourceTXID: input.sourceTXID ?? input.sourceTransaction?.id("hex") ?? "",
          sourceOutputIndex: input.sourceOutputIndex,
          sequence: isSingle || isNone ? 0 : input.sequence ?? 4294967295,
          // Default to max sequence number
          script: emptyScript
        }));
        inputs.splice(params.inputIndex, 0, currentInput);
        writeInputs(inputs);
      } else if (isAnyoneCanPay) {
        writeInputs([currentInput]);
      }
      if (isAll) {
        const outputs = params.outputs.map((output) => ({
          satoshis: output.satoshis ?? 0,
          // Default to 0 if undefined
          script: output.lockingScript.toBinary()
        }));
        writeOutputs(outputs);
      } else if (isSingle) {
        const outputs = [];
        for (let i = 0; i < params.inputIndex; i++)
          outputs.push({ satoshis: -1, script: emptyScript });
        const o = params.outputs[params.inputIndex];
        if (o !== void 0) {
          outputs.push({ satoshis: o.satoshis ?? 0, script: o.lockingScript.toBinary() });
        }
        writeOutputs(outputs);
      } else if (isNone) {
        writeOutputs([]);
      }
      writer.writeUInt32LE(params.lockTime);
      writer.writeUInt32LE(params.scope >>> 0);
      const buf = writer.toUint8Array();
      return buf;
    }
    /**
     * Formats the same SIGHASH preimage bytes as `format`, supporting the optional cache for hash reuse.
     * @param params - Context for the signing operation.
     * @param params.cache - Optional `SignatureHashCache` that may already contain hashed prefixes and is populated during formatting.
     * @returns Bytes for signing.
     */
    static formatBip143(params) {
      const cache = params.cache;
      const currentInput = {
        sourceTXID: params.sourceTXID,
        sourceOutputIndex: params.sourceOutputIndex,
        sequence: params.inputSequence
      };
      const inputs = [...params.otherInputs];
      inputs.splice(params.inputIndex, 0, currentInput);
      const getPrevoutHash = () => {
        const writer2 = new Writer();
        for (const input of inputs) {
          if (input.sourceTXID === void 0) {
            if (input.sourceTransaction == null) {
              throw new Error("Missing sourceTransaction for input");
            }
            writer2.write(input.sourceTransaction.hash());
          } else {
            writer2.writeReverse(toArray2(input.sourceTXID, "hex"));
          }
          writer2.writeUInt32LE(input.sourceOutputIndex);
        }
        const buf2 = writer2.toUint8Array();
        const ret = hash256(buf2);
        return ret;
      };
      const getSequenceHash = () => {
        const writer2 = new Writer();
        for (const input of inputs) {
          const sequence = input.sequence ?? 4294967295;
          writer2.writeUInt32LE(sequence);
        }
        const buf2 = writer2.toUint8Array();
        const ret = hash256(buf2);
        return ret;
      };
      function getOutputsHash(outputIndex) {
        const writer2 = new Writer();
        if (outputIndex === void 0) {
          for (const output of params.outputs) {
            const satoshis = output.satoshis ?? 0;
            writer2.writeUInt64LE(satoshis);
            const script = output.lockingScript?.toUint8Array() ?? EMPTY_SCRIPT;
            writer2.writeVarIntNum(script.length);
            writer2.write(script);
          }
        } else {
          const output = params.outputs[outputIndex];
          if (output === void 0) {
            throw new Error(`Output at index ${outputIndex} does not exist`);
          }
          const satoshis = output.satoshis ?? 0;
          writer2.writeUInt64LE(satoshis);
          const script = output.lockingScript?.toUint8Array() ?? EMPTY_SCRIPT;
          writer2.writeVarIntNum(script.length);
          writer2.write(script);
        }
        const buf2 = writer2.toUint8Array();
        const ret = hash256(buf2);
        return ret;
      }
      let hashPrevouts = new Array(32).fill(0);
      let hashSequence = new Array(32).fill(0);
      let hashOutputs = new Array(32).fill(0);
      if ((params.scope & _TransactionSignature.SIGHASH_ANYONECANPAY) === 0) {
        if (cache?.hashPrevouts == null) {
          hashPrevouts = getPrevoutHash();
          if (cache != null)
            cache.hashPrevouts = hashPrevouts;
        } else {
          hashPrevouts = cache.hashPrevouts;
        }
      }
      if ((params.scope & _TransactionSignature.SIGHASH_ANYONECANPAY) === 0 && (params.scope & 31) !== _TransactionSignature.SIGHASH_SINGLE && (params.scope & 31) !== _TransactionSignature.SIGHASH_NONE) {
        if (cache?.hashSequence == null) {
          hashSequence = getSequenceHash();
          if (cache != null)
            cache.hashSequence = hashSequence;
        } else {
          hashSequence = cache.hashSequence;
        }
      }
      if ((params.scope & 31) !== _TransactionSignature.SIGHASH_SINGLE && (params.scope & 31) !== _TransactionSignature.SIGHASH_NONE) {
        if (cache?.hashOutputsAll == null) {
          hashOutputs = getOutputsHash();
          if (cache != null)
            cache.hashOutputsAll = hashOutputs;
        } else {
          hashOutputs = cache.hashOutputsAll;
        }
      } else if ((params.scope & 31) === _TransactionSignature.SIGHASH_SINGLE && params.inputIndex < params.outputs.length) {
        const key2 = params.inputIndex;
        const cachedSingle = cache?.hashOutputsSingle?.get(key2);
        if (cachedSingle == null) {
          hashOutputs = getOutputsHash(key2);
          if (cache != null) {
            cache.hashOutputsSingle ?? (cache.hashOutputsSingle = /* @__PURE__ */ new Map());
            cache.hashOutputsSingle.set(key2, hashOutputs);
          }
        } else {
          hashOutputs = cachedSingle;
        }
      }
      const writer = new Writer();
      writer.writeInt32LE(params.transactionVersion);
      writer.write(hashPrevouts);
      writer.write(hashSequence);
      writer.writeReverse(toArray2(params.sourceTXID, "hex"));
      writer.writeUInt32LE(params.sourceOutputIndex);
      const subscriptBin = params.subscript.toUint8Array();
      writer.writeVarIntNum(subscriptBin.length);
      writer.write(subscriptBin);
      writer.writeUInt64LE(params.sourceSatoshis);
      const sequenceNumber = currentInput.sequence;
      writer.writeUInt32LE(sequenceNumber);
      writer.write(hashOutputs);
      writer.writeUInt32LE(params.lockTime);
      writer.writeUInt32LE(params.scope >>> 0);
      const buf = writer.toUint8Array();
      return buf;
    }
    /**
     * Formats the SIGHASH preimage for the targeted input, optionally using a cache to skip recomputing shared hash prefixes.
     * @param params - Context for the signing input plus transaction metadata.
     * @param params.cache - Optional cache storing previously computed `hashPrevouts`, `hashSequence`, or `hashOutputs*` values; it will be populated if present.
     */
    static format(params) {
      return Array.from(this.formatBytes(params));
    }
    static formatBytes(params) {
      const hasForkId = (params.scope & _TransactionSignature.SIGHASH_FORKID) !== 0;
      const hasChronicle = params.ignoreChronicle !== true && (params.scope & _TransactionSignature.SIGHASH_CHRONICLE) !== 0;
      if (hasForkId && !hasChronicle) {
        return _TransactionSignature.formatBip143(params);
      }
      if (!hasForkId || hasForkId && hasChronicle) {
        return _TransactionSignature.formatOTDA(params);
      }
      return new Uint8Array(0);
    }
    static usesOtdaSingleBug(params) {
      const hasForkId = (params.scope & _TransactionSignature.SIGHASH_FORKID) !== 0;
      const hasChronicle = params.ignoreChronicle !== true && (params.scope & _TransactionSignature.SIGHASH_CHRONICLE) !== 0;
      const usesOtda = !hasForkId || hasForkId && hasChronicle;
      return usesOtda && (params.scope & 31) === _TransactionSignature.SIGHASH_SINGLE && params.inputIndex >= params.outputs.length;
    }
    // The format used in a tx
    static fromChecksigFormat(buf) {
      if (buf.length === 0) {
        const r2 = new BigNumber(1);
        const s2 = new BigNumber(1);
        const scope2 = 1;
        return new _TransactionSignature(r2, s2, scope2);
      }
      const scope = buf.at(-1);
      const derbuf = buf.slice(0, buf.length - 1);
      const tempSig = Signature.fromDER(derbuf);
      return new _TransactionSignature(tempSig.r, tempSig.s, scope);
    }
    /**
     * Compares to bitcoind's IsLowDERSignature
     * See also Ecdsa signature algorithm which enforces this.
     * See also Bip 62, "low S values in signatures"
     */
    hasLowS() {
      if (this.s.ltn(1) || this.s.gt(new BigNumber("7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0", "hex"))) {
        return false;
      }
      return true;
    }
    toChecksigFormat() {
      const derbuf = this.toDER();
      return [...derbuf, this.scope];
    }
  };
  __publicField(_TransactionSignature, "SIGHASH_ALL", 1);
  __publicField(_TransactionSignature, "SIGHASH_NONE", 2);
  __publicField(_TransactionSignature, "SIGHASH_SINGLE", 3);
  __publicField(_TransactionSignature, "SIGHASH_CHRONICLE", 32);
  __publicField(_TransactionSignature, "SIGHASH_FORKID", 64);
  __publicField(_TransactionSignature, "SIGHASH_ANYONECANPAY", 128);
  var TransactionSignature = _TransactionSignature;

  // node_modules/@bsv/sdk/dist/esm/src/primitives/Secp256r1.js
  var P = BigInt("0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff");
  var N = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
  var A = P - 3n;
  var B = BigInt("0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b");
  var GX = BigInt("0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296");
  var GY = BigInt("0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5");
  var HALF_N = N >> 1n;

  // node_modules/@bsv/sdk/dist/esm/src/script/LockingScript.js
  var LockingScript = class extends Script {
    /**
     * @method isLockingScript
     * Determines if the script is a locking script.
     * @returns {boolean} Always returns true for a LockingScript instance.
     */
    isLockingScript() {
      return true;
    }
    /**
     * @method isUnlockingScript
     * Determines if the script is an unlocking script.
     * @returns {boolean} Always returns false for a LockingScript instance.
     */
    isUnlockingScript() {
      return false;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/script/UnlockingScript.js
  var UnlockingScript = class extends Script {
    /**
     * @method isLockingScript
     * Determines if the script is a locking script.
     * @returns {boolean} Always returns false for an UnlockingScript instance.
     */
    isLockingScript() {
      return false;
    }
    /**
     * @method isUnlockingScript
     * Determines if the script is an unlocking script.
     * @returns {boolean} Always returns true for an UnlockingScript instance.
     */
    isUnlockingScript() {
      return true;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/script/ScriptEvaluationError.js
  var ScriptEvaluationError = class extends Error {
    constructor(params) {
      const stackHex = params.stackState.map((s2) => s2 != null && s2.length !== void 0 ? toHex(s2) : s2 === null || s2 === void 0 ? "null/undef" : "INVALID_STACK_ITEM").join(", ");
      const altStackHex = params.altStackState.map((s2) => s2 != null && s2.length !== void 0 ? toHex(s2) : s2 === null || s2 === void 0 ? "null/undef" : "INVALID_STACK_ITEM").join(", ");
      const pcInfo = `Context: ${params.context}, PC: ${params.programCounter}`;
      const stackInfo = `Stack: [${stackHex}] (len: ${params.stackState.length}, mem: ${params.stackMem})`;
      const altStackInfo = `AltStack: [${altStackHex}] (len: ${params.altStackState.length}, mem: ${params.altStackMem})`;
      const ifStackInfo = `IfStack: [${params.ifStackState.join(", ")}]`;
      const fullMessage = `Script evaluation error: ${params.message}
TXID: ${params.txid}, OutputIdx: ${params.outputIndex}
${pcInfo}
${stackInfo}
${altStackInfo}
${ifStackInfo}`;
      super(fullMessage);
      __publicField(this, "txid");
      __publicField(this, "outputIndex");
      __publicField(this, "context");
      __publicField(this, "programCounter");
      __publicField(this, "stackState");
      __publicField(this, "altStackState");
      __publicField(this, "ifStackState");
      __publicField(this, "stackMem");
      __publicField(this, "altStackMem");
      this.name = this.constructor.name;
      this.txid = params.txid;
      this.outputIndex = params.outputIndex;
      this.context = params.context;
      this.programCounter = params.programCounter;
      this.stackState = params.stackState.map((s2) => s2.slice());
      this.altStackState = params.altStackState.map((s2) => s2.slice());
      this.ifStackState = params.ifStackState.slice();
      this.stackMem = params.stackMem;
      this.altStackMem = params.altStackMem;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/script/Spend.js
  var maxScriptElementSize = 1024 * 1024 * 1024;
  var maxScriptElementSizeBeforeGenesis = 520;
  var maxScriptSizeBeforeGenesis = 1e4;
  var maxOpsBeforeGenesis = 500;
  var maxStackItemsBeforeGenesis = 1e3;
  var maxMultisigKeyCount = Math.pow(2, 31) - 1;
  var maxMultisigKeyCountBigInt = BigInt(maxMultisigKeyCount);
  var maxMultisigKeyCountBeforeGenesis = 20;
  var sequenceLocktimeDisableFlag = 2147483648;
  var SCRIPTNUM_NEG_1 = Object.freeze(new BigNumber(-1).toScriptNum());
  var SCRIPTNUMS_0_TO_16 = Object.freeze(Array.from({ length: 17 }, (_, i) => Object.freeze(new BigNumber(i).toScriptNum())));
  function compareNumberArrays(a, b) {
    if (a.length !== b.length)
      return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i])
        return false;
    }
    return true;
  }
  function isMinimallyEncodedHelper(buf, maxNumSize = Number.MAX_SAFE_INTEGER) {
    if (buf.length > maxNumSize) {
      return false;
    }
    if (buf.length > 0) {
      if ((buf.at(-1) & 127) === 0) {
        if (buf.length <= 1 || (buf.at(-2) & 128) === 0) {
          return false;
        }
      }
    }
    return true;
  }
  function isChecksigFormatHelper(buf) {
    if (buf.length < 9 || buf.length > 73)
      return false;
    if (buf[0] !== 48)
      return false;
    if (buf[1] !== buf.length - 3)
      return false;
    const rMarker = buf[2];
    const rLen = buf[3];
    if (rMarker !== 2)
      return false;
    if (rLen === 0)
      return false;
    if (5 + rLen >= buf.length)
      return false;
    const sMarkerOffset = 4 + rLen;
    const sMarker = buf[sMarkerOffset];
    const sLen = buf[sMarkerOffset + 1];
    if (sMarker !== 2)
      return false;
    if (sLen === 0)
      return false;
    if ((buf[4] & 128) !== 0)
      return false;
    if (rLen > 1 && buf[4] === 0 && (buf[5] & 128) === 0)
      return false;
    const sValueOffset = sMarkerOffset + 2;
    if ((buf[sValueOffset] & 128) !== 0)
      return false;
    if (sLen > 1 && buf[sValueOffset] === 0 && (buf[sValueOffset + 1] & 128) === 0)
      return false;
    if (rLen + sLen + 7 !== buf.length)
      return false;
    return true;
  }
  function isChunkMinimalPushHelper(chunk) {
    const data = chunk.data;
    const op3 = chunk.op;
    if (!Array.isArray(data))
      return true;
    if (data.length === 0)
      return op3 === OP_default.OP_0;
    if (data.length === 1 && data[0] >= 1 && data[0] <= 16)
      return op3 === OP_default.OP_1 + (data[0] - 1);
    if (data.length === 1 && data[0] === 129)
      return op3 === OP_default.OP_1NEGATE;
    if (data.length <= 75)
      return op3 === data.length;
    if (data.length <= 255)
      return op3 === OP_default.OP_PUSHDATA1;
    if (data.length <= 65535)
      return op3 === OP_default.OP_PUSHDATA2;
    return true;
  }
  var Spend = class {
    /**
     * @constructor
     * Constructs the Spend object with necessary transaction details.
     * @param {string} params.sourceTXID - The transaction ID of the source UTXO.
     * @param {number} params.sourceOutputIndex - The index of the output in the source transaction.
     * @param {BigNumber} params.sourceSatoshis - The amount of satoshis in the source UTXO.
     * @param {LockingScript} params.lockingScript - The locking script associated with the UTXO.
     * @param {number} params.transactionVersion - The version of the current transaction.
     * @param {Array<{ sourceTXID: string, sourceOutputIndex: number, sequence: number }>} params.otherInputs -
     *        An array of other inputs in the transaction.
     * @param {Array<{ satoshis: BigNumber, lockingScript: LockingScript }>} params.outputs -
     *        The outputs of the current transaction.
     * @param {number} params.inputIndex - The index of this input in the current transaction.
     * @param {UnlockingScript} params.unlockingScript - The unlocking script for this spend.
     * @param {number} params.inputSequence - The sequence number of this input.
     * @param {number} params.lockTime - The lock time of the transaction.
     * @param {number} params.memoryLimit - Optional control over script interpreter memory usage.
     * @param {boolean} params.isRelaxed - Optional. If true, disables all the unlocking script maleability restrictions consitent with Chronicle release. Maleability restrictions are neve appliced to locking scripts.
     *
     * @example
     * const spend = new Spend({
     *   sourceTXID: "abcd1234", // sourceTXID
     *   sourceOutputIndex: 0, // sourceOutputIndex
     *   sourceSatoshis: new BigNumber(1000), // sourceSatoshis
     *   lockingScript: LockingScript.fromASM("OP_DUP OP_HASH160 abcd1234... OP_EQUALVERIFY OP_CHECKSIG"),
     *   transactionVersion: 1, // transactionVersion
     *   otherInputs: [{ sourceTXID: "abcd1234", sourceOutputIndex: 1, sequence: 0xffffffff }], // otherInputs
     *   outputs: [{ satoshis: new BigNumber(500), lockingScript: LockingScript.fromASM("OP_DUP...") }], // outputs
     *   inputIndex: 0, // inputIndex
     *   unlockingScript: UnlockingScript.fromASM("3045... 02ab..."),
     *   inputSequence: 0xffffffff // inputSequence
     *   memoryLimit: 100000 // memoryLimit
     * });
     */
    constructor(params) {
      __publicField(this, "sourceTXID");
      __publicField(this, "sourceOutputIndex");
      __publicField(this, "sourceSatoshis");
      __publicField(this, "lockingScript");
      __publicField(this, "transactionVersion");
      __publicField(this, "otherInputs");
      __publicField(this, "outputs");
      __publicField(this, "inputIndex");
      __publicField(this, "unlockingScript");
      __publicField(this, "inputSequence");
      __publicField(this, "lockTime");
      __publicField(this, "context");
      __publicField(this, "programCounter");
      __publicField(this, "lastCodeSeparator");
      __publicField(this, "stack");
      __publicField(this, "altStack");
      __publicField(this, "ifStack");
      __publicField(this, "elseStack");
      __publicField(this, "memoryLimit");
      __publicField(this, "stackMem");
      __publicField(this, "altStackMem");
      __publicField(this, "isRelaxedOverride");
      __publicField(this, "verifyFlags");
      __publicField(this, "executedOpCount");
      __publicField(this, "returningFromConditional");
      __publicField(this, "sigHashCache");
      this.sourceTXID = params.sourceTXID;
      this.sourceOutputIndex = params.sourceOutputIndex;
      this.sourceSatoshis = params.sourceSatoshis;
      this.lockingScript = params.lockingScript;
      this.transactionVersion = params.transactionVersion;
      this.otherInputs = params.otherInputs;
      this.outputs = params.outputs;
      this.inputIndex = params.inputIndex;
      this.unlockingScript = params.unlockingScript;
      this.inputSequence = params.inputSequence;
      this.lockTime = params.lockTime;
      this.memoryLimit = params.memoryLimit ?? 32e6;
      this.isRelaxedOverride = params.isRelaxed === true;
      if (params.verifyFlags === void 0) {
        this.verifyFlags = void 0;
      } else {
        const flagArr = Array.isArray(params.verifyFlags) ? params.verifyFlags : params.verifyFlags.split(",");
        this.verifyFlags = new Set(flagArr.map((flag) => flag.trim()).filter((flag) => flag.length > 0));
      }
      this.stack = [];
      this.altStack = [];
      this.ifStack = [];
      this.elseStack = [];
      this.stackMem = 0;
      this.altStackMem = 0;
      this.executedOpCount = 0;
      this.returningFromConditional = false;
      this.sigHashCache = { hashOutputsSingle: /* @__PURE__ */ new Map() };
      this.reset();
    }
    isRelaxed() {
      return this.isRelaxedOverride || this.transactionVersion > 1;
    }
    hasExplicitFlags() {
      return this.verifyFlags !== void 0;
    }
    hasFlag(flag) {
      return this.verifyFlags?.has(flag) === true;
    }
    isAfterGenesis() {
      if (this.hasExplicitFlags()) {
        return this.hasFlag("GENESIS") || this.hasFlag("UTXO_AFTER_GENESIS") || this.hasFlag("UTXO_AFTER_CHRONICLE");
      }
      return this.isRelaxed();
    }
    isAfterChronicle() {
      if (this.hasExplicitFlags())
        return this.hasFlag("UTXO_AFTER_CHRONICLE");
      return this.isRelaxed();
    }
    shouldEnforceMinimalData() {
      if (this.hasExplicitFlags())
        return this.hasFlag("MINIMALDATA");
      return !this.isRelaxed();
    }
    shouldEnforceLowS() {
      if (this.hasExplicitFlags())
        return this.hasFlag("LOW_S");
      return !this.isRelaxed();
    }
    shouldEnforceNullDummy() {
      if (this.hasExplicitFlags())
        return this.hasFlag("NULLDUMMY");
      return !this.isRelaxed();
    }
    shouldEnforceSigPushOnly() {
      if (this.hasExplicitFlags())
        return this.hasFlag("SIGPUSHONLY");
      return !this.isRelaxed();
    }
    shouldEnforceCleanStack() {
      if (this.hasExplicitFlags())
        return this.hasFlag("CLEANSTACK");
      return !this.isRelaxed();
    }
    shouldEnforceDerSignatures() {
      if (this.hasExplicitFlags()) {
        return this.hasFlag("DERSIG") || this.hasFlag("STRICTENC") || this.hasFlag("LOW_S") || this.hasFlag("SIGHASH_FORKID");
      }
      return true;
    }
    shouldEnforceStrictEncoding() {
      if (this.hasExplicitFlags()) {
        return this.hasFlag("STRICTENC") || this.hasFlag("SIGHASH_FORKID");
      }
      return true;
    }
    scriptNumMaxSize() {
      if (this.hasExplicitFlags() && !this.isAfterGenesis())
        return 4;
      return void 0;
    }
    maxPushSize() {
      if (this.hasExplicitFlags() && !this.isAfterGenesis())
        return maxScriptElementSizeBeforeGenesis;
      return maxScriptElementSize;
    }
    reset() {
      this.context = "UnlockingScript";
      this.programCounter = 0;
      this.lastCodeSeparator = null;
      this.stack = [];
      this.altStack = [];
      this.ifStack = [];
      this.elseStack = [];
      this.stackMem = 0;
      this.altStackMem = 0;
      this.executedOpCount = 0;
      this.returningFromConditional = false;
      this.sigHashCache = { hashOutputsSingle: /* @__PURE__ */ new Map() };
    }
    ensureStackMem(additional) {
      if (this.stackMem + additional > this.memoryLimit) {
        this.scriptEvaluationError("Stack memory usage has exceeded " + String(this.memoryLimit) + " bytes");
      }
    }
    ensureAltStackMem(additional) {
      if (this.altStackMem + additional > this.memoryLimit) {
        this.scriptEvaluationError("Alt stack memory usage has exceeded " + String(this.memoryLimit) + " bytes");
      }
    }
    pushStack(item) {
      this.ensureStackMem(item.length);
      this.stack.push(item);
      this.stackMem += item.length;
    }
    pushStackCopy(item) {
      this.ensureStackMem(item.length);
      const copy = item.slice();
      this.stack.push(copy);
      this.stackMem += copy.length;
    }
    popStack() {
      if (this.stack.length === 0) {
        this.scriptEvaluationError("Attempted to pop from an empty stack.");
      }
      const item = this.stack.pop();
      if (item === void 0) {
        this.scriptEvaluationError("Attempted to pop from an empty stack.");
        return [];
      }
      this.stackMem -= item.length;
      return item;
    }
    stackTop(index = -1) {
      if (this.stack.length === 0 || this.stack.length < Math.abs(index) || index >= 0 && index >= this.stack.length) {
        this.scriptEvaluationError(`Stack underflow accessing element at index ${index}. Stack length is ${this.stack.length}.`);
      }
      return this.stack[this.stack.length + index];
    }
    setStack(items) {
      this.stack = items.map((item) => item.slice());
      this.stackMem = this.stack.reduce((total, item) => total + item.length, 0);
    }
    clearAltStack() {
      this.altStack = [];
      this.altStackMem = 0;
    }
    pushAltStack(item) {
      this.ensureAltStackMem(item.length);
      this.altStack.push(item);
      this.altStackMem += item.length;
    }
    popAltStack() {
      if (this.altStack.length === 0) {
        this.scriptEvaluationError("Attempted to pop from an empty alt stack.");
      }
      const item = this.altStack.pop();
      if (item === void 0) {
        this.scriptEvaluationError("Attempted to pop from an empty alt stack.");
        return [];
      }
      this.altStackMem -= item.length;
      return item;
    }
    readScriptNumber(buf) {
      try {
        return BigNumber.fromScriptNum(buf, this.shouldEnforceMinimalData(), this.scriptNumMaxSize());
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        this.scriptEvaluationError(message);
      }
      return new BigNumber(0);
    }
    isDefinedHashType(scope) {
      const baseType = scope & 31;
      return baseType >= TransactionSignature.SIGHASH_ALL && baseType <= TransactionSignature.SIGHASH_SINGLE;
    }
    checkSignatureEncoding(buf) {
      if (buf.length === 0)
        return true;
      const enforceDer = this.shouldEnforceDerSignatures();
      if (enforceDer && !isChecksigFormatHelper(buf)) {
        this.scriptEvaluationError("The signature format is invalid.");
        return false;
      }
      try {
        const sig = TransactionSignature.fromChecksigFormat(buf);
        if (this.shouldEnforceStrictEncoding() && !this.isDefinedHashType(sig.scope)) {
          this.scriptEvaluationError("The signature hash type is invalid.");
          return false;
        }
        if (this.shouldEnforceStrictEncoding() && (sig.scope & TransactionSignature.SIGHASH_CHRONICLE) !== 0 && !this.isAfterChronicle()) {
          this.scriptEvaluationError("The signature hash type is invalid before Chronicle.");
          return false;
        }
        const hasForkId = (sig.scope & TransactionSignature.SIGHASH_FORKID) !== 0;
        if (this.hasExplicitFlags()) {
          if (this.hasFlag("SIGHASH_FORKID") && !hasForkId) {
            this.scriptEvaluationError("The signature must use SIGHASH_FORKID.");
            return false;
          }
          if (!this.hasFlag("SIGHASH_FORKID") && !this.isAfterGenesis() && hasForkId) {
            this.scriptEvaluationError("The signature must not use SIGHASH_FORKID.");
            return false;
          }
        }
        if (this.shouldEnforceLowS() && !sig.hasLowS()) {
          this.scriptEvaluationError("The signature must have a low S value.");
          return false;
        }
      } catch {
        if (enforceDer) {
          this.scriptEvaluationError("The signature format is invalid.");
          return false;
        }
      }
      return true;
    }
    parseChecksigSignature(buf) {
      try {
        return TransactionSignature.fromChecksigFormat(buf);
      } catch (e) {
        if (this.shouldEnforceDerSignatures())
          throw e;
        return this.parseLaxChecksigSignature(buf);
      }
    }
    readLaxDERLength(buf, position) {
      const first = buf[position.value++];
      if (first === void 0)
        throw new Error("Invalid DER length");
      if ((first & 128) === 0)
        return first;
      const lengthBytes = first & 127;
      if (lengthBytes === 0 || position.value + lengthBytes > buf.length) {
        throw new Error("Invalid DER length");
      }
      let length = 0;
      for (let i = 0; i < lengthBytes; i++) {
        length = length << 8 | (buf[position.value++] ?? 0);
      }
      return length;
    }
    parseLaxDERInteger(buf, position, sequenceEnd) {
      if (position.value >= sequenceEnd || buf[position.value++] !== 2) {
        throw new Error("Invalid DER integer");
      }
      const length = this.readLaxDERLength(buf, position);
      if (position.value + length > sequenceEnd) {
        throw new Error("Invalid DER integer length");
      }
      let bytes2 = buf.slice(position.value, position.value + length);
      position.value += length;
      while (bytes2.length > 1 && bytes2[0] === 0)
        bytes2 = bytes2.slice(1);
      if (bytes2.length === 0)
        bytes2 = [0];
      return new BigNumber(bytes2);
    }
    parseLaxChecksigSignature(buf) {
      if (buf.length === 0)
        return TransactionSignature.fromChecksigFormat(buf);
      const scope = buf.at(-1);
      const der = buf.slice(0, -1);
      const position = { value: 0 };
      if (der[position.value++] !== 48)
        throw new Error("Signature DER must start with 0x30");
      const sequenceLength = this.readLaxDERLength(der, position);
      const sequenceEnd = Math.min(position.value + sequenceLength, der.length);
      const r2 = this.parseLaxDERInteger(der, position, sequenceEnd);
      const s2 = this.parseLaxDERInteger(der, position, sequenceEnd);
      return new TransactionSignature(r2, s2, scope);
    }
    checkPublicKeyEncoding(buf) {
      if (!this.shouldEnforceStrictEncoding())
        return true;
      if (buf.length === 0) {
        this.scriptEvaluationError("Public key is empty.");
        return false;
      }
      if (buf.length < 33) {
        this.scriptEvaluationError("The public key is too short, it must be at least 33 bytes.");
        return false;
      }
      if (buf[0] === 4) {
        if (buf.length !== 65) {
          this.scriptEvaluationError("The non-compressed public key must be 65 bytes.");
          return false;
        }
      } else if (buf[0] === 2 || buf[0] === 3) {
        if (buf.length !== 33) {
          this.scriptEvaluationError("The compressed public key must be 33 bytes.");
          return false;
        }
      } else {
        this.scriptEvaluationError("The public key is in an unknown format.");
        return false;
      }
      try {
        PublicKey.fromDER(buf);
      } catch {
        this.scriptEvaluationError("The public key is in an unknown format.");
        return false;
      }
      return true;
    }
    verifySignature(sig, pubkey, subscript) {
      const params = {
        sourceTXID: this.sourceTXID,
        sourceOutputIndex: this.sourceOutputIndex,
        sourceSatoshis: this.sourceSatoshis,
        transactionVersion: this.transactionVersion,
        otherInputs: this.otherInputs,
        outputs: this.outputs,
        inputIndex: this.inputIndex,
        subscript,
        inputSequence: this.inputSequence,
        lockTime: this.lockTime,
        scope: sig.scope,
        cache: this.sigHashCache
      };
      const hash = TransactionSignature.usesOtdaSingleBug(params) ? new BigNumber([1, ...new Array(31).fill(0)]) : new BigNumber(hash256(TransactionSignature.formatBytes(params)));
      return verify(hash, sig, pubkey);
    }
    step() {
      if (this.stackMem > this.memoryLimit) {
        this.scriptEvaluationError("Stack memory usage has exceeded " + String(this.memoryLimit) + " bytes");
        return false;
      }
      if (this.altStackMem > this.memoryLimit) {
        this.scriptEvaluationError("Alt stack memory usage has exceeded " + String(this.memoryLimit) + " bytes");
        return false;
      }
      if (this.context === "UnlockingScript" && this.programCounter >= this.unlockingScript.chunks.length) {
        if (this.ifStack.length > 0) {
          this.scriptEvaluationError("Every OP_IF, OP_NOTIF, or OP_ELSE must be terminated with OP_ENDIF prior to the end of the unlocking script.");
        }
        this.clearAltStack();
        this.ifStack = [];
        this.elseStack = [];
        this.returningFromConditional = false;
        this.lastCodeSeparator = null;
        this.context = "LockingScript";
        this.programCounter = 0;
      }
      const currentScript = this.context === "UnlockingScript" ? this.unlockingScript : this.lockingScript;
      if (this.programCounter >= currentScript.chunks.length) {
        return false;
      }
      const operation = currentScript.chunks[this.programCounter];
      const currentOpcode = operation.op;
      if (currentOpcode === void 0) {
        this.scriptEvaluationError(`Missing opcode in ${this.context} at pc=${this.programCounter}.`);
      }
      if (operation.invalidLength === true) {
        this.scriptEvaluationError(`Malformed push data in ${this.context} at pc=${this.programCounter}.`);
      }
      if (Array.isArray(operation.data) && operation.data.length > this.maxPushSize()) {
        this.scriptEvaluationError(`Data push > ${this.maxPushSize()} bytes (pc=${this.programCounter}).`);
      }
      const isScriptExecuting = !this.returningFromConditional && !this.ifStack.includes(false);
      if (this.hasExplicitFlags() && !this.isAfterGenesis() && !this.isAfterChronicle() && (currentOpcode === OP_default.OP_2MUL || currentOpcode === OP_default.OP_2DIV || currentOpcode === OP_default.OP_VERIF || currentOpcode === OP_default.OP_VERNOTIF)) {
        this.scriptEvaluationError(`${OP_default[currentOpcode]} is disabled until Chronicle.`);
      }
      if (isScriptExecuting && currentOpcode >= 0 && currentOpcode <= OP_default.OP_PUSHDATA4) {
        if (this.shouldEnforceMinimalData() && !isChunkMinimalPushHelper(operation)) {
          this.scriptEvaluationError(`This data is not minimally-encoded. (PC: ${this.programCounter})`);
        }
        this.pushStack(Array.isArray(operation.data) ? operation.data : []);
      } else if (isScriptExecuting || currentOpcode >= OP_default.OP_IF && currentOpcode <= OP_default.OP_ENDIF) {
        let buf, buf1, buf2, buf3;
        let x1, x2, x3;
        let bn, bn1, bn2, bn3;
        let n, size, fValue, fSuccess, subscript;
        let bufSig, bufPubkey;
        let sig, pubkey;
        let i, ikey, isig, nKeysCount, nSigsCount, fOk;
        if (isScriptExecuting && currentOpcode > OP_default.OP_16) {
          this.executedOpCount++;
          if (this.hasExplicitFlags() && !this.isAfterGenesis() && this.executedOpCount > maxOpsBeforeGenesis) {
            this.scriptEvaluationError(`Script executed more than ${maxOpsBeforeGenesis} opcodes.`);
          }
        }
        if (this.hasExplicitFlags() && !this.isAfterChronicle()) {
          if (isScriptExecuting && (currentOpcode === OP_default.OP_SUBSTR || currentOpcode === OP_default.OP_LEFT || currentOpcode === OP_default.OP_RIGHT || currentOpcode === OP_default.OP_LSHIFTNUM || currentOpcode === OP_default.OP_RSHIFTNUM)) {
            if (this.hasFlag("DISCOURAGE_UPGRADABLE_NOPS")) {
              this.scriptEvaluationError(`${OP_default[currentOpcode]} is discouraged by verification flags.`);
            }
            this.programCounter++;
            return true;
          }
          if ((isScriptExecuting || !this.isAfterGenesis()) && (currentOpcode === OP_default.OP_2MUL || currentOpcode === OP_default.OP_2DIV)) {
            this.scriptEvaluationError(`${OP_default[currentOpcode]} is disabled until Chronicle.`);
          }
          if ((isScriptExecuting || !this.isAfterGenesis()) && (currentOpcode === OP_default.OP_VER || currentOpcode === OP_default.OP_VERIF || currentOpcode === OP_default.OP_VERNOTIF)) {
            this.scriptEvaluationError(`${OP_default[currentOpcode]} is disabled until Chronicle.`);
          }
          if (!isScriptExecuting && this.isAfterGenesis() && (currentOpcode === OP_default.OP_VERIF || currentOpcode === OP_default.OP_VERNOTIF)) {
            this.programCounter++;
            return true;
          }
        }
        if (isScriptExecuting && this.hasFlag("DISCOURAGE_UPGRADABLE_NOPS") && (currentOpcode === OP_default.OP_NOP1 || currentOpcode === OP_default.OP_CHECKLOCKTIMEVERIFY || currentOpcode === OP_default.OP_CHECKSEQUENCEVERIFY || currentOpcode === OP_default.OP_NOP9 || currentOpcode === OP_default.OP_NOP10)) {
          this.scriptEvaluationError(`${OP_default[currentOpcode]} is discouraged by verification flags.`);
        }
        switch (currentOpcode) {
          case OP_default.OP_VER: {
            const ver = this.transactionVersion;
            this.pushStack([ver & 255, ver >>> 8 & 255, ver >>> 16 & 255, ver >>> 24 & 255]);
            break;
          }
          case OP_default.OP_SUBSTR: {
            if (this.stack.length < 3)
              this.scriptEvaluationError("OP_SUBSTR requires at least three items to be on the stack.");
            const len = this.readScriptNumber(this.popStack()).toNumber();
            const offset = this.readScriptNumber(this.popStack()).toNumber();
            buf = this.popStack();
            const size2 = buf.length;
            if (offset < 0 || offset >= size2 || len < 0 || len > size2 - offset) {
              this.scriptEvaluationError(`OP_SUBSTR offset (${offset}) must be in range [0, ${size2}) and length (${len}) must be in range [0, ${size2 - offset}]`);
            }
            this.pushStack(buf.slice(offset, offset + len));
            break;
          }
          case OP_default.OP_LEFT: {
            if (this.stack.length < 2)
              this.scriptEvaluationError("OP_LEFT requires at least two items to be on the stack.");
            const len = this.readScriptNumber(this.popStack()).toNumber();
            buf = this.popStack();
            const size2 = buf.length;
            if (len < 0 || len > size2) {
              this.scriptEvaluationError(`OP_LEFT length (${len}) must be in range [0, ${size2}]`);
            }
            this.pushStack(buf.slice(0, len));
            break;
          }
          case OP_default.OP_RIGHT: {
            if (this.stack.length < 2)
              this.scriptEvaluationError("OP_RIGHT requires at least two items to be on the stack.");
            const len = this.readScriptNumber(this.popStack()).toNumber();
            buf = this.popStack();
            const size2 = buf.length;
            if (len < 0 || len > size2) {
              this.scriptEvaluationError(`OP_RIGHT length (${len}) must be in range [0, ${size2}]`);
            }
            this.pushStack(buf.slice(size2 - len));
            break;
          }
          case OP_default.OP_LSHIFTNUM: {
            if (this.stack.length < 2)
              this.scriptEvaluationError("OP_LSHIFTNUM requires at least two items to be on the stack.");
            const bits = this.readScriptNumber(this.popStack()).toBigInt();
            if (bits < 0) {
              this.scriptEvaluationError("OP_LSHIFTNUM bits to shift must not be negative.");
            }
            const value = this.readScriptNumber(this.popStack()).toBigInt();
            const resultBn = new BigNumber(value << bits);
            this.pushStack(resultBn.toScriptNum());
            break;
          }
          case OP_default.OP_RSHIFTNUM: {
            if (this.stack.length < 2)
              this.scriptEvaluationError("OP_RSHIFTNUM requires at least two items to be on the stack.");
            const bits = this.readScriptNumber(this.popStack()).toBigInt();
            if (bits < 0) {
              this.scriptEvaluationError("OP_RSHIFTNUM bits to shift must not be negative.");
            }
            const value = this.readScriptNumber(this.popStack()).toBigInt();
            let resultBn;
            if (value < 0) {
              resultBn = new BigNumber(-(-value >> bits));
            } else {
              resultBn = new BigNumber(value >> bits);
            }
            this.pushStack(resultBn.toScriptNum());
            break;
          }
          case OP_default.OP_1NEGATE:
            this.pushStackCopy(SCRIPTNUM_NEG_1);
            break;
          case OP_default.OP_0:
            this.pushStackCopy(SCRIPTNUMS_0_TO_16[0]);
            break;
          case OP_default.OP_1:
          case OP_default.OP_2:
          case OP_default.OP_3:
          case OP_default.OP_4:
          case OP_default.OP_5:
          case OP_default.OP_6:
          case OP_default.OP_7:
          case OP_default.OP_8:
          case OP_default.OP_9:
          case OP_default.OP_10:
          case OP_default.OP_11:
          case OP_default.OP_12:
          case OP_default.OP_13:
          case OP_default.OP_14:
          case OP_default.OP_15:
          case OP_default.OP_16:
            n = currentOpcode - (OP_default.OP_1 - 1);
            this.pushStackCopy(SCRIPTNUMS_0_TO_16[n]);
            break;
          case OP_default.OP_NOP:
          case OP_default.OP_NOP1:
          case OP_default.OP_CHECKLOCKTIMEVERIFY:
            break;
          case OP_default.OP_CHECKSEQUENCEVERIFY:
            if (this.hasFlag("CHECKSEQUENCEVERIFY")) {
              if (this.stack.length < 1)
                this.scriptEvaluationError("OP_CHECKSEQUENCEVERIFY requires at least one item to be on the stack.");
              let sequenceLock = 0n;
              try {
                sequenceLock = BigNumber.fromScriptNum(this.stackTop(), this.shouldEnforceMinimalData(), 5).toBigInt();
              } catch {
                this.scriptEvaluationError("OP_CHECKSEQUENCEVERIFY requires a minimally-encoded numeric lock time.");
              }
              if (sequenceLock < 0n)
                this.scriptEvaluationError("OP_CHECKSEQUENCEVERIFY requires a non-negative lock time.");
              if (Number(sequenceLock & BigInt(sequenceLocktimeDisableFlag)) === 0 && this.transactionVersion < 2) {
                this.scriptEvaluationError("OP_CHECKSEQUENCEVERIFY lock time is unsatisfied.");
              }
            }
            break;
          case OP_default.OP_NOP9:
          case OP_default.OP_NOP10:
            break;
          case OP_default.OP_VERIF:
          case OP_default.OP_VERNOTIF:
            fValue = false;
            if (isScriptExecuting) {
              if (this.stack.length < 1)
                this.scriptEvaluationError("OP_VERIF and OP_VERNOTIF require at least one item on the stack when they are used!");
              buf1 = this.popStack();
              if (buf1.length === 4) {
                const ver = this.transactionVersion;
                buf2 = [ver & 255, ver >>> 8 & 255, ver >>> 16 & 255, ver >>> 24 & 255];
                fValue = compareNumberArrays(buf1, buf2);
              }
              if (currentOpcode === OP_default.OP_VERNOTIF)
                fValue = !fValue;
            }
            this.ifStack.push(fValue);
            this.elseStack.push(false);
            break;
          case OP_default.OP_IF:
          case OP_default.OP_NOTIF:
            fValue = false;
            if (isScriptExecuting) {
              if (this.stack.length < 1)
                this.scriptEvaluationError("OP_IF and OP_NOTIF require at least one item on the stack when they are used!");
              buf = this.popStack();
              if (this.hasFlag("MINIMALIF") && buf.length > 0 && !(buf.length === 1 && buf[0] === 1)) {
                this.scriptEvaluationError("OP_IF and OP_NOTIF require minimal truth values.");
              }
              fValue = this.castToBool(buf);
              if (currentOpcode === OP_default.OP_NOTIF)
                fValue = !fValue;
            }
            this.ifStack.push(fValue);
            this.elseStack.push(false);
            break;
          case OP_default.OP_ELSE:
            if (this.ifStack.length === 0)
              this.scriptEvaluationError("OP_ELSE requires a preceeding OP_IF.");
            if (this.hasExplicitFlags() && this.isAfterGenesis() && this.elseStack.at(-1)) {
              this.scriptEvaluationError("OP_ELSE may only be used once for each OP_IF or OP_NOTIF after Genesis.");
            }
            this.elseStack[this.elseStack.length - 1] = true;
            this.ifStack[this.ifStack.length - 1] = !this.ifStack.at(-1);
            break;
          case OP_default.OP_ENDIF:
            if (this.ifStack.length === 0)
              this.scriptEvaluationError("OP_ENDIF requires a preceeding OP_IF.");
            this.ifStack.pop();
            this.elseStack.pop();
            break;
          case OP_default.OP_VERIFY:
            if (this.stack.length < 1)
              this.scriptEvaluationError("OP_VERIFY requires at least one item to be on the stack.");
            buf1 = this.stackTop();
            fValue = this.castToBool(buf1);
            if (!fValue)
              this.scriptEvaluationError("OP_VERIFY requires the top stack value to be truthy.");
            this.popStack();
            break;
          case OP_default.OP_RETURN:
            if (this.hasExplicitFlags() && !this.isAfterGenesis()) {
              this.scriptEvaluationError("OP_RETURN is invalid before Genesis.");
            }
            if (this.ifStack.length > 0) {
              this.returningFromConditional = true;
            } else {
              if (this.context === "UnlockingScript")
                this.programCounter = this.unlockingScript.chunks.length;
              else
                this.programCounter = this.lockingScript.chunks.length;
              this.programCounter--;
            }
            break;
          case OP_default.OP_TOALTSTACK:
            if (this.stack.length < 1)
              this.scriptEvaluationError("OP_TOALTSTACK requires at oeast one item to be on the stack.");
            this.pushAltStack(this.popStack());
            break;
          case OP_default.OP_FROMALTSTACK:
            if (this.altStack.length < 1)
              this.scriptEvaluationError("OP_FROMALTSTACK requires at least one item to be on the stack.");
            this.pushStack(this.popAltStack());
            break;
          case OP_default.OP_2DROP:
            if (this.stack.length < 2)
              this.scriptEvaluationError("OP_2DROP requires at least two items to be on the stack.");
            this.popStack();
            this.popStack();
            break;
          case OP_default.OP_2DUP:
            if (this.stack.length < 2)
              this.scriptEvaluationError("OP_2DUP requires at least two items to be on the stack.");
            buf1 = this.stackTop(-2);
            buf2 = this.stackTop(-1);
            this.pushStackCopy(buf1);
            this.pushStackCopy(buf2);
            break;
          case OP_default.OP_3DUP:
            if (this.stack.length < 3)
              this.scriptEvaluationError("OP_3DUP requires at least three items to be on the stack.");
            buf1 = this.stackTop(-3);
            buf2 = this.stackTop(-2);
            buf3 = this.stackTop(-1);
            this.pushStackCopy(buf1);
            this.pushStackCopy(buf2);
            this.pushStackCopy(buf3);
            break;
          case OP_default.OP_2OVER:
            if (this.stack.length < 4)
              this.scriptEvaluationError("OP_2OVER requires at least four items to be on the stack.");
            buf1 = this.stackTop(-4);
            buf2 = this.stackTop(-3);
            this.pushStackCopy(buf1);
            this.pushStackCopy(buf2);
            break;
          case OP_default.OP_2ROT: {
            if (this.stack.length < 6)
              this.scriptEvaluationError("OP_2ROT requires at least six items to be on the stack.");
            const rot6 = this.popStack();
            const rot5 = this.popStack();
            const rot4 = this.popStack();
            const rot3 = this.popStack();
            const rot2 = this.popStack();
            const rot1 = this.popStack();
            this.pushStack(rot3);
            this.pushStack(rot4);
            this.pushStack(rot5);
            this.pushStack(rot6);
            this.pushStack(rot1);
            this.pushStack(rot2);
            break;
          }
          case OP_default.OP_2SWAP: {
            if (this.stack.length < 4)
              this.scriptEvaluationError("OP_2SWAP requires at least four items to be on the stack.");
            const swap4 = this.popStack();
            const swap3 = this.popStack();
            const swap2 = this.popStack();
            const swap1 = this.popStack();
            this.pushStack(swap3);
            this.pushStack(swap4);
            this.pushStack(swap1);
            this.pushStack(swap2);
            break;
          }
          case OP_default.OP_IFDUP:
            if (this.stack.length < 1)
              this.scriptEvaluationError("OP_IFDUP requires at least one item to be on the stack.");
            buf1 = this.stackTop();
            if (this.castToBool(buf1)) {
              this.pushStackCopy(buf1);
            }
            break;
          case OP_default.OP_DEPTH:
            this.pushStack(new BigNumber(this.stack.length).toScriptNum());
            break;
          case OP_default.OP_DROP:
            if (this.stack.length < 1)
              this.scriptEvaluationError("OP_DROP requires at least one item to be on the stack.");
            this.popStack();
            break;
          case OP_default.OP_DUP:
            if (this.stack.length < 1)
              this.scriptEvaluationError("OP_DUP requires at least one item to be on the stack.");
            this.pushStackCopy(this.stackTop());
            break;
          case OP_default.OP_NIP:
            if (this.stack.length < 2)
              this.scriptEvaluationError("OP_NIP requires at least two items to be on the stack.");
            buf2 = this.popStack();
            this.popStack();
            this.pushStack(buf2);
            break;
          case OP_default.OP_OVER:
            if (this.stack.length < 2)
              this.scriptEvaluationError("OP_OVER requires at least two items to be on the stack.");
            this.pushStackCopy(this.stackTop(-2));
            break;
          case OP_default.OP_PICK:
          case OP_default.OP_ROLL: {
            if (this.stack.length < 2)
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires at least two items to be on the stack.`);
            bn = this.readScriptNumber(this.popStack());
            const nBigInt = bn.toBigInt();
            if (nBigInt < 0n || nBigInt >= BigInt(this.stack.length)) {
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires the top stack element to be 0 or a positive number less than the current size of the stack.`);
            }
            const nIndex = Number(nBigInt);
            const itemToMoveOrCopy = this.stack[this.stack.length - 1 - nIndex];
            if (currentOpcode === OP_default.OP_ROLL) {
              this.stack.splice(this.stack.length - 1 - nIndex, 1);
              this.stackMem -= itemToMoveOrCopy.length;
              this.pushStack(itemToMoveOrCopy);
            } else {
              this.pushStackCopy(itemToMoveOrCopy);
            }
            break;
          }
          case OP_default.OP_ROT:
            if (this.stack.length < 3)
              this.scriptEvaluationError("OP_ROT requires at least three items to be on the stack.");
            x3 = this.popStack();
            x2 = this.popStack();
            x1 = this.popStack();
            this.pushStack(x2);
            this.pushStack(x3);
            this.pushStack(x1);
            break;
          case OP_default.OP_SWAP:
            if (this.stack.length < 2)
              this.scriptEvaluationError("OP_SWAP requires at least two items to be on the stack.");
            x2 = this.popStack();
            x1 = this.popStack();
            this.pushStack(x2);
            this.pushStack(x1);
            break;
          case OP_default.OP_TUCK:
            if (this.stack.length < 2)
              this.scriptEvaluationError("OP_TUCK requires at least two items to be on the stack.");
            buf1 = this.stackTop(-1);
            this.ensureStackMem(buf1.length);
            this.stack.splice(-2, 0, buf1.slice());
            this.stackMem += buf1.length;
            break;
          case OP_default.OP_SIZE:
            if (this.stack.length < 1)
              this.scriptEvaluationError("OP_SIZE requires at least one item to be on the stack.");
            this.pushStack(new BigNumber(this.stackTop().length).toScriptNum());
            break;
          case OP_default.OP_AND:
          case OP_default.OP_OR:
          case OP_default.OP_XOR: {
            if (this.stack.length < 2)
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires at least two items on the stack.`);
            buf2 = this.popStack();
            buf1 = this.popStack();
            if (buf1.length !== buf2.length)
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires the top two stack items to be the same size.`);
            const resultBufBitwiseOp = new Array(buf1.length);
            for (let k = 0; k < buf1.length; k++) {
              if (currentOpcode === OP_default.OP_AND)
                resultBufBitwiseOp[k] = buf1[k] & buf2[k];
              else if (currentOpcode === OP_default.OP_OR)
                resultBufBitwiseOp[k] = buf1[k] | buf2[k];
              else
                resultBufBitwiseOp[k] = buf1[k] ^ buf2[k];
            }
            this.pushStack(resultBufBitwiseOp);
            break;
          }
          case OP_default.OP_INVERT: {
            if (this.stack.length < 1)
              this.scriptEvaluationError("OP_INVERT requires at least one item to be on the stack.");
            buf = this.popStack();
            const invertedBufOp = new Array(buf.length);
            for (let k = 0; k < buf.length; k++) {
              invertedBufOp[k] = ~buf[k] & 255;
            }
            this.pushStack(invertedBufOp);
            break;
          }
          case OP_default.OP_LSHIFT:
          case OP_default.OP_RSHIFT: {
            if (this.stack.length < 2)
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires at least two items to be on the stack.`);
            bn2 = this.readScriptNumber(this.popStack());
            buf1 = this.popStack();
            const shiftBits = bn2.toBigInt();
            if (shiftBits < 0n)
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires the top item on the stack not to be negative.`);
            if (buf1.length === 0) {
              this.pushStack([]);
              break;
            }
            bn1 = new BigNumber(buf1);
            let shiftedBn;
            if (currentOpcode === OP_default.OP_LSHIFT) {
              shiftedBn = bn1.ushln(shiftBits);
              const mask = new BigNumber(1).ushln(buf1.length * 8).isubn(1);
              shiftedBn = shiftedBn.iand(mask);
            } else {
              shiftedBn = bn1.ushrn(shiftBits);
            }
            const shiftedArr = shiftedBn.toArray("be", buf1.length);
            this.pushStack(shiftedArr);
            break;
          }
          case OP_default.OP_EQUAL:
          case OP_default.OP_EQUALVERIFY:
            if (this.stack.length < 2)
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires at least two items to be on the stack.`);
            buf2 = this.popStack();
            buf1 = this.popStack();
            fValue = compareNumberArrays(buf1, buf2);
            this.pushStack(fValue ? [1] : []);
            if (currentOpcode === OP_default.OP_EQUALVERIFY) {
              if (!fValue)
                this.scriptEvaluationError("OP_EQUALVERIFY requires the top two stack items to be equal.");
              this.popStack();
            }
            break;
          case OP_default.OP_1ADD:
          case OP_default.OP_1SUB:
          case OP_default.OP_2MUL:
          case OP_default.OP_2DIV:
          case OP_default.OP_NEGATE:
          case OP_default.OP_ABS:
          case OP_default.OP_NOT:
          case OP_default.OP_0NOTEQUAL:
            if (this.stack.length < 1)
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires at least one item to be on the stack.`);
            bn = this.readScriptNumber(this.popStack());
            switch (currentOpcode) {
              case OP_default.OP_1ADD:
                bn = bn.add(new BigNumber(1));
                break;
              case OP_default.OP_1SUB:
                bn = bn.sub(new BigNumber(1));
                break;
              case OP_default.OP_2MUL:
                bn = bn.mul(new BigNumber(2));
                break;
              case OP_default.OP_2DIV:
                bn = bn.div(new BigNumber(2));
                break;
              case OP_default.OP_NEGATE:
                bn = bn.neg();
                break;
              case OP_default.OP_ABS:
                if (bn.isNeg())
                  bn = bn.neg();
                break;
              case OP_default.OP_NOT:
                bn = new BigNumber(bn.cmpn(0) === 0 ? 1 : 0);
                break;
              case OP_default.OP_0NOTEQUAL:
                bn = new BigNumber(bn.cmpn(0) === 0 ? 0 : 1);
                break;
            }
            this.pushStack(bn.toScriptNum());
            break;
          case OP_default.OP_ADD:
          case OP_default.OP_SUB:
          case OP_default.OP_MUL:
          case OP_default.OP_DIV:
          case OP_default.OP_MOD:
          case OP_default.OP_BOOLAND:
          case OP_default.OP_BOOLOR:
          case OP_default.OP_NUMEQUAL:
          case OP_default.OP_NUMEQUALVERIFY:
          case OP_default.OP_NUMNOTEQUAL:
          case OP_default.OP_LESSTHAN:
          case OP_default.OP_GREATERTHAN:
          case OP_default.OP_LESSTHANOREQUAL:
          case OP_default.OP_GREATERTHANOREQUAL:
          case OP_default.OP_MIN:
          case OP_default.OP_MAX: {
            if (this.stack.length < 2)
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires at least two items to be on the stack.`);
            buf2 = this.popStack();
            buf1 = this.popStack();
            bn2 = this.readScriptNumber(buf2);
            bn1 = this.readScriptNumber(buf1);
            let predictedLen = 0;
            switch (currentOpcode) {
              case OP_default.OP_MUL:
                predictedLen = bn1.byteLength() + bn2.byteLength();
                break;
              case OP_default.OP_ADD:
              case OP_default.OP_SUB:
                predictedLen = Math.max(bn1.byteLength(), bn2.byteLength()) + 1;
                break;
              default:
                predictedLen = Math.max(bn1.byteLength(), bn2.byteLength());
            }
            this.ensureStackMem(predictedLen);
            let resultBnArithmetic = new BigNumber(0);
            switch (currentOpcode) {
              case OP_default.OP_ADD:
                resultBnArithmetic = bn1.add(bn2);
                break;
              case OP_default.OP_SUB:
                resultBnArithmetic = bn1.sub(bn2);
                break;
              case OP_default.OP_MUL:
                resultBnArithmetic = bn1.mul(bn2);
                break;
              case OP_default.OP_DIV:
                if (bn2.cmpn(0) === 0)
                  this.scriptEvaluationError("OP_DIV cannot divide by zero!");
                resultBnArithmetic = bn1.div(bn2);
                break;
              case OP_default.OP_MOD:
                if (bn2.cmpn(0) === 0)
                  this.scriptEvaluationError("OP_MOD cannot divide by zero!");
                resultBnArithmetic = bn1.mod(bn2);
                break;
              case OP_default.OP_BOOLAND:
                resultBnArithmetic = new BigNumber(bn1.cmpn(0) !== 0 && bn2.cmpn(0) !== 0 ? 1 : 0);
                break;
              case OP_default.OP_BOOLOR:
                resultBnArithmetic = new BigNumber(bn1.cmpn(0) !== 0 || bn2.cmpn(0) !== 0 ? 1 : 0);
                break;
              case OP_default.OP_NUMEQUAL:
                resultBnArithmetic = new BigNumber(bn1.cmp(bn2) === 0 ? 1 : 0);
                break;
              case OP_default.OP_NUMEQUALVERIFY:
                resultBnArithmetic = new BigNumber(bn1.cmp(bn2) === 0 ? 1 : 0);
                break;
              case OP_default.OP_NUMNOTEQUAL:
                resultBnArithmetic = new BigNumber(bn1.cmp(bn2) === 0 ? 0 : 1);
                break;
              case OP_default.OP_LESSTHAN:
                resultBnArithmetic = new BigNumber(bn1.cmp(bn2) < 0 ? 1 : 0);
                break;
              case OP_default.OP_GREATERTHAN:
                resultBnArithmetic = new BigNumber(bn1.cmp(bn2) > 0 ? 1 : 0);
                break;
              case OP_default.OP_LESSTHANOREQUAL:
                resultBnArithmetic = new BigNumber(bn1.cmp(bn2) <= 0 ? 1 : 0);
                break;
              case OP_default.OP_GREATERTHANOREQUAL:
                resultBnArithmetic = new BigNumber(bn1.cmp(bn2) >= 0 ? 1 : 0);
                break;
              case OP_default.OP_MIN:
                resultBnArithmetic = bn1.cmp(bn2) < 0 ? bn1 : bn2;
                break;
              case OP_default.OP_MAX:
                resultBnArithmetic = bn1.cmp(bn2) > 0 ? bn1 : bn2;
                break;
            }
            this.pushStack(resultBnArithmetic.toScriptNum());
            if (currentOpcode === OP_default.OP_NUMEQUALVERIFY) {
              if (!this.castToBool(this.stackTop()))
                this.scriptEvaluationError("OP_NUMEQUALVERIFY requires the top stack item to be truthy.");
              this.popStack();
            }
            break;
          }
          case OP_default.OP_WITHIN:
            if (this.stack.length < 3)
              this.scriptEvaluationError("OP_WITHIN requires at least three items to be on the stack.");
            bn3 = this.readScriptNumber(this.popStack());
            bn2 = this.readScriptNumber(this.popStack());
            bn1 = this.readScriptNumber(this.popStack());
            fValue = bn1.cmp(bn2) >= 0 && bn1.cmp(bn3) < 0;
            this.pushStack(fValue ? [1] : []);
            break;
          case OP_default.OP_RIPEMD160:
          case OP_default.OP_SHA1:
          case OP_default.OP_SHA256:
          case OP_default.OP_HASH160:
          case OP_default.OP_HASH256: {
            if (this.stack.length < 1)
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires at least one item to be on the stack.`);
            buf = this.popStack();
            let hashResult = [];
            if (currentOpcode === OP_default.OP_RIPEMD160)
              hashResult = ripemd160(buf);
            else if (currentOpcode === OP_default.OP_SHA1)
              hashResult = sha1(buf);
            else if (currentOpcode === OP_default.OP_SHA256)
              hashResult = sha256(buf);
            else if (currentOpcode === OP_default.OP_HASH160)
              hashResult = hash160(buf);
            else if (currentOpcode === OP_default.OP_HASH256)
              hashResult = hash256(buf);
            this.pushStack(hashResult);
            break;
          }
          case OP_default.OP_CODESEPARATOR:
            this.lastCodeSeparator = this.programCounter;
            break;
          case OP_default.OP_CHECKSIG:
          case OP_default.OP_CHECKSIGVERIFY: {
            if (this.stack.length < 2)
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires at least two items to be on the stack.`);
            bufPubkey = this.popStack();
            bufSig = this.popStack();
            if (!this.checkSignatureEncoding(bufSig) || !this.checkPublicKeyEncoding(bufPubkey)) {
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires correct encoding for the public key and signature.`);
            }
            fSuccess = false;
            if (bufSig.length > 0) {
              try {
                sig = this.parseChecksigSignature(bufSig);
                const scriptForChecksig = this.context === "UnlockingScript" ? this.unlockingScript : this.lockingScript;
                const scriptCodeChunks = scriptForChecksig.chunks.slice(this.lastCodeSeparator === null ? 0 : this.lastCodeSeparator + 1);
                subscript = new Script(scriptCodeChunks);
                subscript.findAndDelete(new Script().writeBin(bufSig));
                pubkey = PublicKey.fromDER(bufPubkey);
                fSuccess = this.verifySignature(sig, pubkey, subscript);
              } catch {
                fSuccess = false;
              }
            }
            if (!fSuccess && this.hasFlag("NULLFAIL") && bufSig.length > 0) {
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires failing signatures to be empty.`);
            }
            this.pushStack(fSuccess ? [1] : []);
            if (currentOpcode === OP_default.OP_CHECKSIGVERIFY) {
              if (!fSuccess)
                this.scriptEvaluationError("OP_CHECKSIGVERIFY requires that a valid signature is provided.");
              this.popStack();
            }
            break;
          }
          case OP_default.OP_CHECKMULTISIG:
          case OP_default.OP_CHECKMULTISIGVERIFY: {
            i = 1;
            if (this.stack.length < i) {
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires at least 1 item for nKeys.`);
            }
            const nKeysCountBN = this.readScriptNumber(this.stackTop(-i));
            const nKeysCountBigInt = nKeysCountBN.toBigInt();
            const multisigKeyLimitBigInt = this.hasExplicitFlags() && !this.isAfterGenesis() ? BigInt(maxMultisigKeyCountBeforeGenesis) : maxMultisigKeyCountBigInt;
            if (nKeysCountBigInt < 0n || nKeysCountBigInt > multisigKeyLimitBigInt) {
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires a key count between 0 and ${multisigKeyLimitBigInt.toString()}.`);
            }
            nKeysCount = Number(nKeysCountBigInt);
            const declaredKeyCount = nKeysCount;
            ikey = ++i;
            i += nKeysCount;
            if (this.stack.length < i) {
              this.scriptEvaluationError(`${OP_default[currentOpcode]} stack too small for nKeys and keys. Need ${i}, have ${this.stack.length}.`);
            }
            const nSigsCountBN = this.readScriptNumber(this.stackTop(-i));
            const nSigsCountBigInt = nSigsCountBN.toBigInt();
            if (nSigsCountBigInt < 0n || nSigsCountBigInt > BigInt(nKeysCount)) {
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires the number of signatures to be no greater than the number of keys.`);
            }
            nSigsCount = Number(nSigsCountBigInt);
            const declaredSigCount = nSigsCount;
            isig = ++i;
            i += nSigsCount;
            if (this.stack.length < i) {
              this.scriptEvaluationError(`${OP_default[currentOpcode]} stack too small for N, keys, M, sigs, and dummy. Need ${i}, have ${this.stack.length}.`);
            }
            const baseScriptCMS = this.context === "UnlockingScript" ? this.unlockingScript : this.lockingScript;
            const subscriptChunksCMS = baseScriptCMS.chunks.slice(this.lastCodeSeparator === null ? 0 : this.lastCodeSeparator + 1);
            subscript = new Script(subscriptChunksCMS);
            let hasNonEmptySignature = false;
            for (let k = 0; k < nSigsCount; k++) {
              bufSig = this.stackTop(-isig - k);
              if (bufSig.length > 0)
                hasNonEmptySignature = true;
              subscript.findAndDelete(new Script().writeBin(bufSig));
            }
            fSuccess = true;
            while (fSuccess && nSigsCount > 0) {
              if (nKeysCount === 0) {
                fSuccess = false;
                break;
              }
              bufSig = this.stackTop(-isig);
              bufPubkey = this.stackTop(-ikey);
              if (!this.checkSignatureEncoding(bufSig) || !this.checkPublicKeyEncoding(bufPubkey)) {
                this.scriptEvaluationError(`${OP_default[currentOpcode]} requires correct encoding for the public key and signature.`);
              }
              fOk = false;
              if (bufSig.length > 0) {
                try {
                  sig = this.parseChecksigSignature(bufSig);
                  pubkey = PublicKey.fromDER(bufPubkey);
                  fOk = this.verifySignature(sig, pubkey, subscript);
                } catch {
                  fOk = false;
                }
              }
              if (fOk) {
                isig++;
                nSigsCount--;
              }
              ikey++;
              nKeysCount--;
              if (nSigsCount > nKeysCount) {
                fSuccess = false;
              }
            }
            if (!fSuccess && this.hasFlag("NULLFAIL") && hasNonEmptySignature) {
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires failing signatures to be empty.`);
            }
            const itemsConsumedByOp = 1 + // N_val
            declaredKeyCount + // keys
            1 + // M_val
            declaredSigCount + // sigs
            1;
            let popCount = itemsConsumedByOp - 1;
            while (popCount > 0) {
              this.popStack();
              popCount--;
            }
            if (this.stack.length < 1) {
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires an extra item (dummy) to be on the stack.`);
            }
            const dummyBuf = this.popStack();
            if (this.shouldEnforceNullDummy() && dummyBuf.length > 0) {
              this.scriptEvaluationError(`${OP_default[currentOpcode]} requires the extra stack item (dummy) to be empty.`);
            }
            this.pushStack(fSuccess ? [1] : []);
            if (currentOpcode === OP_default.OP_CHECKMULTISIGVERIFY) {
              if (!fSuccess)
                this.scriptEvaluationError("OP_CHECKMULTISIGVERIFY requires that a sufficient number of valid signatures are provided.");
              this.popStack();
            }
            break;
          }
          case OP_default.OP_CAT: {
            if (this.stack.length < 2)
              this.scriptEvaluationError("OP_CAT requires at least two items to be on the stack.");
            buf2 = this.popStack();
            buf1 = this.popStack();
            const catResult = buf1.concat(buf2);
            if (catResult.length > this.maxPushSize())
              this.scriptEvaluationError(`It's not currently possible to push data larger than ${this.maxPushSize()} bytes.`);
            this.pushStack(catResult);
            break;
          }
          case OP_default.OP_SPLIT: {
            if (this.stack.length < 2)
              this.scriptEvaluationError("OP_SPLIT requires at least two items to be on the stack.");
            const posBuf = this.popStack();
            const dataToSplit = this.popStack();
            const splitIndexBigInt = this.readScriptNumber(posBuf).toBigInt();
            if (splitIndexBigInt < 0n || splitIndexBigInt > BigInt(dataToSplit.length)) {
              this.scriptEvaluationError("OP_SPLIT requires the first stack item to be a non-negative number less than or equal to the size of the second-from-top stack item.");
            }
            const splitIndex = Number(splitIndexBigInt);
            this.pushStack(dataToSplit.slice(0, splitIndex));
            this.pushStack(dataToSplit.slice(splitIndex));
            break;
          }
          case OP_default.OP_NUM2BIN: {
            if (this.stack.length < 2)
              this.scriptEvaluationError("OP_NUM2BIN requires at least two items to be on the stack.");
            const sizeBigInt = this.readScriptNumber(this.popStack()).toBigInt();
            if (sizeBigInt > BigInt(this.maxPushSize()) || sizeBigInt < 0n) {
              this.scriptEvaluationError(`It's not currently possible to push data larger than ${this.maxPushSize()} bytes or negative size.`);
            }
            size = Number(sizeBigInt);
            let rawnum = this.popStack();
            rawnum = minimallyEncode(rawnum);
            if (rawnum.length > size) {
              this.scriptEvaluationError("OP_NUM2BIN requires that the size expressed in the top stack item is large enough to hold the value expressed in the second-from-top stack item.");
            }
            if (rawnum.length === size) {
              this.pushStack(rawnum);
              break;
            }
            const resultN2B = new Array(size).fill(0);
            let signbit = 0;
            if (rawnum.length > 0) {
              signbit = rawnum.at(-1) & 128;
              rawnum[rawnum.length - 1] &= 127;
            }
            for (let k = 0; k < rawnum.length; k++) {
              resultN2B[k] = rawnum[k];
            }
            if (signbit !== 0) {
              resultN2B[size - 1] |= 128;
            }
            this.pushStack(resultN2B);
            break;
          }
          case OP_default.OP_BIN2NUM: {
            if (this.stack.length < 1)
              this.scriptEvaluationError("OP_BIN2NUM requires at least one item to be on the stack.");
            buf1 = this.popStack();
            const b2nResult = minimallyEncode(buf1);
            if (!isMinimallyEncodedHelper(b2nResult)) {
              this.scriptEvaluationError("OP_BIN2NUM requires that the resulting number is valid.");
            }
            this.pushStack(b2nResult);
            break;
          }
          default:
            this.scriptEvaluationError(`Invalid opcode ${currentOpcode} (pc=${this.programCounter}).`);
        }
      }
      if (this.returningFromConditional && this.ifStack.length === 0) {
        this.programCounter = currentScript.chunks.length;
      } else {
        this.programCounter++;
      }
      if (this.hasExplicitFlags() && !this.isAfterGenesis() && this.stack.length + this.altStack.length > maxStackItemsBeforeGenesis) {
        this.scriptEvaluationError(`Stack item count has exceeded ${maxStackItemsBeforeGenesis}.`);
      }
      return true;
    }
    /**
     * @method validate
     * Validates the spend action by interpreting the locking and unlocking scripts.
     * @returns {boolean} Returns true if the scripts are valid and the spend is legitimate, otherwise false.
     * @example
     * if (spend.validate()) {
     *   console.log("Spend is valid!");
     * } else {
     *   console.log("Invalid spend!");
     * }
     */
    validate() {
      if (this.shouldEnforceSigPushOnly() && !this.unlockingScript.isPushOnly()) {
        this.scriptEvaluationError("Unlocking scripts can only contain push operations, and no other opcodes.");
      }
      const originalLockingScript = this.lockingScript;
      const shouldEvaluateP2SH = this.hasFlag("P2SH") && !this.isAfterGenesis() && this.isP2SHLockingScript(this.lockingScript);
      if (shouldEvaluateP2SH && !this.unlockingScript.isPushOnly()) {
        this.scriptEvaluationError("P2SH unlocking scripts can only contain push operations.");
      }
      this.reset();
      this.runScript("UnlockingScript");
      const stackAfterUnlockingScript = this.stack.map((item) => item.slice());
      this.runScript("LockingScript");
      this.requireTruthyTopStack();
      try {
        if (shouldEvaluateP2SH) {
          if (stackAfterUnlockingScript.length === 0) {
            this.scriptEvaluationError("P2SH evaluation requires a redeem script on the stack.");
          }
          const redeemScriptBytes = stackAfterUnlockingScript.pop();
          if (redeemScriptBytes === void 0) {
            this.scriptEvaluationError("P2SH evaluation requires a redeem script on the stack.");
            return false;
          }
          this.setStack(stackAfterUnlockingScript);
          const redeemScript = Script.fromBinary(redeemScriptBytes);
          this.lockingScript = new LockingScript(redeemScript.chunks);
          this.runScript("LockingScript");
        }
      } finally {
        this.lockingScript = originalLockingScript;
      }
      if (this.shouldEnforceCleanStack() && this.stack.length !== 1) {
        this.scriptEvaluationError(`The clean stack rule requires exactly one item to be on the stack after script execution, found ${this.stack.length}.`);
      }
      this.requireTruthyTopStack();
      return true;
    }
    runScript(context) {
      this.context = context;
      this.programCounter = 0;
      this.ifStack = [];
      this.elseStack = [];
      this.returningFromConditional = false;
      this.clearAltStack();
      this.lastCodeSeparator = null;
      const script = context === "UnlockingScript" ? this.unlockingScript : this.lockingScript;
      if (this.hasExplicitFlags() && !this.isAfterGenesis() && script.toUint8Array().length > maxScriptSizeBeforeGenesis) {
        this.scriptEvaluationError(`Script size exceeds ${maxScriptSizeBeforeGenesis} bytes.`);
      }
      while (this.programCounter < script.chunks.length) {
        this.step();
      }
      if (this.ifStack.length > 0) {
        this.scriptEvaluationError("Every OP_IF, OP_NOTIF, or OP_ELSE must be terminated with OP_ENDIF prior to the end of the script.");
      }
      this.ifStack = [];
      this.elseStack = [];
      this.clearAltStack();
      this.lastCodeSeparator = null;
    }
    isP2SHLockingScript(script) {
      const chunks = script.chunks;
      return chunks.length === 3 && chunks[0].op === OP_default.OP_HASH160 && chunks[1].op === 20 && Array.isArray(chunks[1].data) && chunks[1].data.length === 20 && chunks[2].op === OP_default.OP_EQUAL;
    }
    requireTruthyTopStack() {
      if (this.stack.length === 0) {
        this.scriptEvaluationError("The top stack element must be truthy after script evaluation (stack is empty).");
      } else if (!this.castToBool(this.stackTop())) {
        this.scriptEvaluationError("The top stack element must be truthy after script evaluation.");
      }
    }
    castToBool(val2) {
      if (val2.length === 0)
        return false;
      for (let i = 0; i < val2.length; i++) {
        if (val2[i] !== 0) {
          return !(i === val2.length - 1 && val2[i] === 128);
        }
      }
      return false;
    }
    scriptEvaluationError(str) {
      throw new ScriptEvaluationError({
        message: str,
        txid: this.sourceTXID,
        outputIndex: this.sourceOutputIndex,
        context: this.context,
        programCounter: this.programCounter,
        stackState: this.stack,
        altStackState: this.altStack,
        ifStackState: this.ifStack,
        stackMem: this.stackMem,
        altStackMem: this.altStackMem
      });
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/script/templates/SignatureUtils.js
  function computeSignatureScope(signOutputs, anyoneCanPay) {
    let signatureScope = TransactionSignature.SIGHASH_FORKID;
    if (signOutputs === "all") {
      signatureScope |= TransactionSignature.SIGHASH_ALL;
    }
    if (signOutputs === "none") {
      signatureScope |= TransactionSignature.SIGHASH_NONE;
    }
    if (signOutputs === "single") {
      signatureScope |= TransactionSignature.SIGHASH_SINGLE;
    }
    if (anyoneCanPay) {
      signatureScope |= TransactionSignature.SIGHASH_ANYONECANPAY;
    }
    return signatureScope;
  }
  function resolveSourceDetails(tx, inputIndex, providedSourceSatoshis, providedLockingScript) {
    const input = tx.inputs[inputIndex];
    const otherInputs = tx.inputs.filter((_, index) => index !== inputIndex);
    const sourceTXID = input.sourceTXID ?? input.sourceTransaction?.id("hex");
    if (sourceTXID == null || sourceTXID === void 0) {
      throw new Error("The input sourceTXID or sourceTransaction is required for transaction signing.");
    }
    if (sourceTXID === "") {
      throw new Error("The input sourceTXID or sourceTransaction is required for transaction signing.");
    }
    const sourceSatoshis = providedSourceSatoshis ?? input.sourceTransaction?.outputs[input.sourceOutputIndex].satoshis;
    if (sourceSatoshis == null || sourceSatoshis === void 0) {
      throw new Error("The sourceSatoshis or input sourceTransaction is required for transaction signing.");
    }
    const lockingScript = providedLockingScript ?? input.sourceTransaction?.outputs[input.sourceOutputIndex].lockingScript;
    if (lockingScript == null) {
      throw new Error("The lockingScript or input sourceTransaction is required for transaction signing.");
    }
    return { sourceTXID, sourceSatoshis, lockingScript, otherInputs };
  }
  function formatPreimage(params) {
    const { tx, inputIndex, signatureScope, sourceTXID, sourceSatoshis, lockingScript, otherInputs, inputSequence } = params;
    const input = tx.inputs[inputIndex];
    return TransactionSignature.format({
      sourceTXID,
      sourceOutputIndex: verifyNotNull(input.sourceOutputIndex, "input.sourceOutputIndex must have value"),
      sourceSatoshis,
      transactionVersion: tx.version,
      otherInputs,
      inputIndex,
      outputs: tx.outputs,
      inputSequence: inputSequence ?? verifyNotNull(input.sequence, "input.sequence must have value"),
      subscript: lockingScript,
      lockTime: tx.lockTime,
      scope: signatureScope
    });
  }

  // node_modules/@bsv/sdk/dist/esm/src/script/templates/P2PKH.js
  var P2PKH = class {
    /**
     * Creates a P2PKH locking script for a given public key hash or address string
     *
     * @param {number[] | string} pubkeyhash or address - An array or address representing the public key hash.
     * @returns {LockingScript} - A P2PKH locking script.
     */
    lock(pubkeyhash) {
      let data;
      if (typeof pubkeyhash === "string") {
        const hash = fromBase58Check(pubkeyhash);
        if (hash.prefix[0] !== 0 && hash.prefix[0] !== 111) {
          throw new Error("only P2PKH is supported");
        }
        data = hash.data;
      } else {
        data = pubkeyhash;
      }
      if (data.length !== 20) {
        throw new Error("P2PKH hash length must be 20 bytes");
      }
      return new LockingScript([
        { op: OP_default.OP_DUP },
        { op: OP_default.OP_HASH160 },
        { op: data.length, data },
        { op: OP_default.OP_EQUALVERIFY },
        { op: OP_default.OP_CHECKSIG }
      ]);
    }
    /**
     * Creates a function that generates a P2PKH unlocking script along with its signature and length estimation.
     *
     * The returned object contains:
     * 1. `sign` - A function that, when invoked with a transaction and an input index,
     *    produces an unlocking script suitable for a P2PKH locked output.
     * 2. `estimateLength` - A function that returns the estimated length of the unlocking script in bytes.
     *
     * @param {PrivateKey} privateKey - The private key used for signing the transaction.
     * @param {'all'|'none'|'single'} signOutputs - The signature scope for outputs.
     * @param {boolean} anyoneCanPay - Flag indicating if the signature allows for other inputs to be added later.
     * @param {number} sourceSatoshis - Optional. The amount being unlocked. Otherwise the input.sourceTransaction is required.
     * @param {Script} lockingScript - Optional. The lockinScript. Otherwise the input.sourceTransaction is required.
     * @returns {Object} - An object containing the `sign` and `estimateLength` functions.
     */
    unlock(privateKey, signOutputs = "all", anyoneCanPay = false, sourceSatoshis, lockingScript) {
      return {
        sign: async (tx, inputIndex) => {
          const signatureScope = computeSignatureScope(signOutputs, anyoneCanPay);
          const resolved = resolveSourceDetails(tx, inputIndex, sourceSatoshis, lockingScript);
          sourceSatoshis = resolved.sourceSatoshis;
          lockingScript = resolved.lockingScript;
          const preimage = formatPreimage({
            tx,
            inputIndex,
            signatureScope,
            sourceTXID: resolved.sourceTXID,
            sourceSatoshis: resolved.sourceSatoshis,
            lockingScript: resolved.lockingScript,
            otherInputs: resolved.otherInputs
          });
          const rawSignature = privateKey.sign(sha256(preimage));
          const sig = new TransactionSignature(rawSignature.r, rawSignature.s, signatureScope);
          const sigForScript = sig.toChecksigFormat();
          const pubkeyForScript = privateKey.toPublicKey().encode(true);
          return new UnlockingScript([
            { op: sigForScript.length, data: sigForScript },
            { op: pubkeyForScript.length, data: pubkeyForScript }
          ]);
        },
        estimateLength: async () => {
          return 108;
        }
      };
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/transaction/fee-models/SatoshisPerKilobyte.js
  var SatoshisPerKilobyte = class {
    /**
     * Constructs an instance of the sat/kb fee model.
     *
     * @param {number} value - The number of satoshis per kilobyte to charge as a fee.
     */
    constructor(value) {
      /**
       * @property
       * Denotes the number of satoshis paid per kilobyte of transaction size.
       */
      __publicField(this, "value");
      this.value = value;
    }
    /**
     * Computes the fee for a given transaction.
     *
     * @param tx The transaction for which a fee is to be computed.
     * @returns The fee in satoshis for the transaction, as a BigNumber.
     */
    async computeFee(tx) {
      const getVarIntSize = (i) => {
        if (i > 2 ** 32) {
          return 9;
        } else if (i > 2 ** 16) {
          return 5;
        } else if (i > 253) {
          return 3;
        } else {
          return 1;
        }
      };
      let size = 4;
      size += getVarIntSize(tx.inputs.length);
      for (let i = 0; i < tx.inputs.length; i++) {
        const input = tx.inputs[i];
        size += 40;
        let scriptLength;
        if (typeof input.unlockingScript === "object") {
          scriptLength = input.unlockingScript.toBinary().length;
        } else if (typeof input.unlockingScriptTemplate === "object") {
          scriptLength = await input.unlockingScriptTemplate.estimateLength(tx, i);
        } else {
          throw new TypeError("All inputs must have an unlocking script or an unlocking script template for sat/kb fee computation.");
        }
        size += getVarIntSize(scriptLength);
        size += scriptLength;
      }
      size += getVarIntSize(tx.outputs.length);
      for (const out of tx.outputs) {
        size += 8;
        const length = out.lockingScript.toBinary().length;
        size += getVarIntSize(length);
        size += length;
      }
      size += 4;
      const fee = Math.ceil(size / 1e3 * this.value);
      return fee;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/transaction/fee-models/LivePolicy.js
  var _LivePolicy = class _LivePolicy extends SatoshisPerKilobyte {
    /**
     * Constructs an instance of the live policy fee model.
     *
     * @param {number} cacheValidityMs - How long to cache the fee rate in milliseconds (default: 5 minutes)
     */
    constructor(cacheValidityMs = 5 * 60 * 1e3) {
      super(100);
      __publicField(this, "cachedRate", null);
      __publicField(this, "cacheTimestamp", 0);
      __publicField(this, "cacheValidityMs");
      this.cacheValidityMs = cacheValidityMs;
    }
    /**
     * Gets the singleton instance of LivePolicy to ensure cache sharing across the application.
     *
     * @param {number} cacheValidityMs - How long to cache the fee rate in milliseconds (default: 5 minutes)
     * @returns The singleton LivePolicy instance
     */
    static getInstance(cacheValidityMs = 5 * 60 * 1e3) {
      if (!_LivePolicy.instance) {
        _LivePolicy.instance = new _LivePolicy(cacheValidityMs);
      }
      return _LivePolicy.instance;
    }
    /**
     * Fetches the current fee rate from ARC GorillaPool API.
     *
     * @returns The current satoshis per kilobyte rate
     */
    async fetchFeeRate() {
      const now = Date.now();
      if (this.cachedRate !== null && now - this.cacheTimestamp < this.cacheValidityMs) {
        return this.cachedRate;
      }
      try {
        const response = await fetch(_LivePolicy.ARC_POLICY_URL);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const response_data = await response.json();
        if (!response_data.policy?.miningFee || typeof response_data.policy.miningFee.satoshis !== "number" || typeof response_data.policy.miningFee.bytes !== "number") {
          throw new Error("Invalid policy response format");
        }
        const rate = response_data.policy.miningFee.satoshis / response_data.policy.miningFee.bytes * 1e3;
        this.cachedRate = rate;
        this.cacheTimestamp = now;
        return rate;
      } catch (error) {
        if (this.cachedRate !== null) {
          console.warn("Failed to fetch live fee rate, using cached value:", error);
          return this.cachedRate;
        }
        console.warn("Failed to fetch live fee rate, using default 100 sat/kb:", error);
        return 100;
      }
    }
    /**
     * Computes the fee for a given transaction using the current live rate.
     * Overrides the parent method to use dynamic rate fetching.
     *
     * @param tx The transaction for which a fee is to be computed.
     * @returns The fee in satoshis for the transaction.
     */
    async computeFee(tx) {
      const rate = await this.fetchFeeRate();
      this.value = rate;
      return super.computeFee(tx);
    }
  };
  __publicField(_LivePolicy, "ARC_POLICY_URL", "https://arc.gorillapool.io/v1/policy");
  __publicField(_LivePolicy, "instance", null);
  var LivePolicy = _LivePolicy;

  // node_modules/@bsv/sdk/dist/esm/src/transaction/http/NodejsHttpRequestUtils.js
  function executeNodejsRequest(https, url, requestOptions, serializeData) {
    return new Promise((resolve, reject) => {
      const req = https.request(url, requestOptions, (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          const ok = res.statusCode >= 200 && res.statusCode <= 299;
          const mediaType = res.headers["content-type"];
          const data = body !== "" && typeof mediaType === "string" && mediaType.startsWith("application/json") ? JSON.parse(body) : body;
          resolve({
            status: res.statusCode,
            statusText: res.statusMessage,
            ok,
            data
          });
        });
      });
      req.on("error", (error) => {
        reject(error);
      });
      if (requestOptions.data !== null && requestOptions.data !== void 0) {
        req.write(serializeData(requestOptions.data));
      }
      req.end();
    });
  }

  // node_modules/@bsv/sdk/dist/esm/src/transaction/http/NodejsHttpClient.js
  var NodejsHttpClient = class {
    constructor(https) {
      __publicField(this, "https");
      this.https = https;
    }
    async request(url, requestOptions) {
      return await executeNodejsRequest(this.https, url, requestOptions, (data) => JSON.stringify(data));
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/transaction/http/FetchHttpClient.js
  var FetchHttpClient = class {
    constructor(fetch2) {
      __publicField(this, "fetch");
      this.fetch = fetch2;
    }
    async request(url, options) {
      const fetchOptions = {
        method: options.method,
        headers: options.headers,
        body: JSON.stringify(options.data)
      };
      const res = await this.fetch(url, fetchOptions);
      const mediaType = res.headers.get("Content-Type");
      const data = mediaType?.startsWith("application/json") ?? false ? await res.json() : await res.text();
      return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        data
      };
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/transaction/http/DefaultHttpClient.js
  function defaultHttpClient() {
    const noHttpClient = {
      async request(..._) {
        throw new Error("No method available to perform HTTP request");
      }
    };
    if (globalThis.window !== void 0 && typeof globalThis.window.fetch === "function") {
      return new FetchHttpClient(globalThis.window.fetch.bind(globalThis.window));
    } else if (typeof globalThis.fetch === "function") {
      return new FetchHttpClient(globalThis.fetch.bind(globalThis));
    } else if (typeof __require === "undefined") {
      return noHttpClient;
    } else {
      try {
        const https = __require("node:https");
        return new NodejsHttpClient(https);
      } catch (_httpsModuleUnavailable) {
        return noHttpClient;
      }
    }
  }

  // node_modules/@bsv/sdk/dist/esm/src/transaction/broadcasters/ARC.js
  function defaultDeploymentId() {
    return `ts-sdk-${toHex(Random_default(16))}`;
  }
  var ARC = class {
    constructor(URL2, config) {
      __publicField(this, "URL");
      __publicField(this, "apiKey");
      __publicField(this, "deploymentId");
      __publicField(this, "callbackUrl");
      __publicField(this, "callbackToken");
      __publicField(this, "headers");
      __publicField(this, "httpClient");
      this.URL = URL2;
      if (typeof config === "string") {
        this.apiKey = config;
        this.httpClient = defaultHttpClient();
        this.deploymentId = defaultDeploymentId();
        this.callbackToken = void 0;
        this.callbackUrl = void 0;
      } else {
        const configObj = config ?? {};
        const { apiKey, deploymentId, httpClient, callbackToken, callbackUrl, headers } = configObj;
        this.apiKey = apiKey;
        this.httpClient = httpClient ?? defaultHttpClient();
        this.deploymentId = deploymentId ?? defaultDeploymentId();
        this.callbackToken = callbackToken;
        this.callbackUrl = callbackUrl;
        this.headers = headers;
      }
    }
    /**
     * Constructs a dictionary of the default & supplied request headers.
     */
    requestHeaders() {
      const headers = {
        "Content-Type": "application/json",
        "XDeployment-ID": this.deploymentId
      };
      if (this.apiKey != null && this.apiKey !== "") {
        headers.Authorization = `Bearer ${this.apiKey}`;
      }
      if (this.callbackUrl != null && this.callbackUrl !== "") {
        headers["X-CallbackUrl"] = this.callbackUrl;
      }
      if (this.callbackToken != null && this.callbackToken !== "") {
        headers["X-CallbackToken"] = this.callbackToken;
      }
      if (this.headers != null) {
        for (const key2 in this.headers) {
          headers[key2] = this.headers[key2];
        }
      }
      return headers;
    }
    /**
     * Broadcasts a transaction via ARC.
     *
     * @param {Transaction} tx - The transaction to be broadcasted.
     * @returns {Promise<BroadcastResponse | BroadcastFailure>} A promise that resolves to either a success or failure response.
     */
    async broadcast(tx) {
      let rawTx;
      try {
        rawTx = tx.toHexEF();
      } catch (error) {
        if (error.message === "All inputs must have source transactions when serializing to EF format") {
          rawTx = tx.toHex();
        } else {
          throw error;
        }
      }
      const requestOptions = {
        method: "POST",
        headers: this.requestHeaders(),
        data: { rawTx }
      };
      try {
        const response = await this.httpClient.request(`${this.URL}/v1/tx`, requestOptions);
        if (response.ok) {
          const { txid, extraInfo, txStatus, competingTxs } = response.data;
          const errorStatuses = [
            "DOUBLE_SPEND_ATTEMPTED",
            "REJECTED",
            "INVALID",
            "MALFORMED",
            "MINED_IN_STALE_BLOCK"
          ];
          const isOrphan = extraInfo?.toUpperCase().includes("ORPHAN") || txStatus?.toUpperCase().includes("ORPHAN");
          if (errorStatuses.includes(txStatus?.toUpperCase()) || isOrphan) {
            const failure = {
              status: "error",
              code: txStatus ?? "UNKNOWN",
              txid,
              description: `${txStatus ?? ""} ${extraInfo ?? ""}`.trim()
            };
            if (competingTxs != null) {
              failure.more = { competingTxs };
            }
            return failure;
          }
          const broadcastRes = {
            status: "success",
            txid,
            message: `${txStatus} ${extraInfo}`
          };
          if (competingTxs != null) {
            broadcastRes.competingTxs = competingTxs;
          }
          return broadcastRes;
        } else {
          const st = typeof response.status;
          const r2 = {
            status: "error",
            code: st === "number" || st === "string" ? response.status.toString() : "ERR_UNKNOWN",
            description: "Unknown error"
          };
          let d = response.data;
          if (typeof d === "string") {
            try {
              d = JSON.parse(response.data);
            } catch {
            }
          }
          if (typeof d === "object") {
            if (d !== null) {
              r2.more = d;
            }
            if (d != null && typeof d.txid === "string") {
              r2.txid = d.txid;
            }
            if (d != null && "detail" in d && typeof d.detail === "string") {
              r2.description = d.detail;
            }
          }
          return r2;
        }
      } catch (error) {
        return {
          status: "error",
          code: "500",
          description: typeof error.message === "string" ? error.message : "Internal Server Error"
        };
      }
    }
    /**
     * Broadcasts multiple transactions via ARC.
     * Handles mixed responses where some transactions succeed and others fail.
     *
     * @param {Transaction[]} txs - Array of transactions to be broadcasted.
     * @returns {Promise<Array<object>>} A promise that resolves to an array of objects.
     */
    async broadcastMany(txs) {
      const rawTxs = txs.map((tx) => {
        try {
          return { rawTx: tx.toHexEF() };
        } catch (error) {
          if (error.message === "All inputs must have source transactions when serializing to EF format") {
            return { rawTx: tx.toHex() };
          }
          throw error;
        }
      });
      const requestOptions = {
        method: "POST",
        headers: this.requestHeaders(),
        data: rawTxs
      };
      try {
        const response = await this.httpClient.request(`${this.URL}/v1/txs`, requestOptions);
        return response.data;
      } catch (error) {
        const errorResponse = {
          status: "error",
          code: "500",
          description: typeof error.message === "string" ? error.message : "Internal Server Error"
        };
        return txs.map(() => errorResponse);
      }
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/transaction/broadcasters/DefaultBroadcaster.js
  function defaultBroadcaster(isTestnet = false, config = {}) {
    return new ARC(isTestnet ? "https://testnet.arc.gorillapool.io" : "https://arc.gorillapool.io", config);
  }

  // node_modules/@bsv/sdk/dist/esm/src/transaction/chaintrackers/WhatsOnChain.js
  var WhatsOnChain = class {
    /**
     * Constructs an instance of the WhatsOnChain ChainTracker.
     *
     * @param {'main' | 'test' | 'stn'} network - The BSV network to use when calling the WhatsOnChain API.
     * @param {WhatsOnChainConfig} config - Configuration options for the WhatsOnChain ChainTracker.
     */
    constructor(network = "main", config = {}) {
      __publicField(this, "network");
      __publicField(this, "apiKey");
      __publicField(this, "URL");
      __publicField(this, "httpClient");
      const { apiKey, httpClient } = config;
      this.network = network;
      this.URL = `https://api.whatsonchain.com/v1/bsv/${network}`;
      this.httpClient = httpClient ?? defaultHttpClient();
      this.apiKey = apiKey ?? "";
    }
    async isValidRootForHeight(root, height) {
      const requestOptions = {
        method: "GET",
        headers: this.getHttpHeaders()
      };
      const response = await this.httpClient.request(`${this.URL}/block/${height}/header`, requestOptions);
      if (response.ok) {
        const { merkleroot } = response.data;
        return merkleroot === root;
      } else if (response.status === 404) {
        return false;
      } else {
        throw new Error(`Failed to verify merkleroot for height ${height} because of an error: ${JSON.stringify(response.data)} `);
      }
    }
    async currentHeight() {
      try {
        const requestOptions = {
          method: "GET",
          headers: this.getHttpHeaders()
        };
        const response = await this.httpClient.request(`${this.URL}/block/headers`, requestOptions);
        if (response.ok) {
          return response.data[0].height;
        } else {
          throw new Error(`Failed to get current height because of an error: ${JSON.stringify(response.data)} `);
        }
      } catch (error) {
        throw new Error(`Failed to get current height because of an error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    getHttpHeaders() {
      const headers = {
        Accept: "application/json"
      };
      if (typeof this.apiKey === "string" && this.apiKey.trim() !== "") {
        headers.Authorization = this.apiKey;
      }
      return headers;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/transaction/chaintrackers/DefaultChainTracker.js
  function defaultChainTracker() {
    return new WhatsOnChain();
  }

  // node_modules/@bsv/sdk/dist/esm/src/transaction/MerklePath.js
  var MerklePath = class _MerklePath {
    constructor(blockHeight, path, legalOffsetsOnly = true) {
      __publicField(this, "blockHeight");
      __publicField(this, "path");
      this.blockHeight = blockHeight;
      this.path = path;
      const legalOffsets = new Array(this.path.length).fill(0).map(() => /* @__PURE__ */ new Set());
      this.path.forEach((leaves, height) => {
        if (leaves.length === 0 && height === 0) {
          throw new Error(`Empty level at height: ${height}`);
        }
        const offsetsAtThisHeight = /* @__PURE__ */ new Set();
        leaves.forEach((leaf) => {
          if (offsetsAtThisHeight.has(leaf.offset)) {
            throw new Error(`Duplicate offset: ${leaf.offset}, at height: ${height}`);
          }
          offsetsAtThisHeight.add(leaf.offset);
          if (height === 0) {
            if (leaf.duplicate !== true) {
              for (let h = 1; h < this.path.length; h++) {
                legalOffsets[h].add(leaf.offset >> h ^ 1);
              }
            }
          } else if (legalOffsetsOnly && !legalOffsets[height].has(leaf.offset)) {
            throw new Error(`Invalid offset: ${leaf.offset}, at height: ${height}, with legal offsets: ${Array.from(legalOffsets[height]).join(", ")}`);
          }
        });
      });
      let root;
      this.path[0].forEach((leaf, idx) => {
        if (idx === 0)
          root = this.computeRoot(leaf.hash);
        if (root !== this.computeRoot(leaf.hash)) {
          throw new Error("Mismatched roots");
        }
      });
    }
    /**
     * Creates a MerklePath instance from a hexadecimal string.
     *
     * @static
     * @param {string} hex - The hexadecimal string representation of the Merkle Path.
     * @returns {MerklePath} - A new MerklePath instance.
     */
    static fromHex(hex) {
      return _MerklePath.fromBinary(toArray2(hex, "hex"));
    }
    static fromReader(reader, legalOffsetsOnly = true) {
      const blockHeight = reader.readVarIntNum();
      const treeHeight = reader.readUInt8();
      const path = new Array(treeHeight).fill(null).map(() => []);
      let flags, offset, nLeavesAtThisHeight;
      for (let level = 0; level < treeHeight; level++) {
        nLeavesAtThisHeight = reader.readVarIntNum();
        while (nLeavesAtThisHeight > 0) {
          offset = reader.readVarIntNum();
          flags = reader.readUInt8();
          const leaf = { offset };
          if ((flags & 1) === 1) {
            leaf.duplicate = true;
          } else {
            if ((flags & 2) !== 0) {
              leaf.txid = true;
            }
            leaf.hash = toHex(reader.read(32).reverse());
          }
          if (!Array.isArray(path[level]) || path[level].length === 0) {
            path[level] = [];
          }
          path[level].push(leaf);
          nLeavesAtThisHeight--;
        }
        path[level].sort((a, b) => a.offset - b.offset);
      }
      return new _MerklePath(blockHeight, path, legalOffsetsOnly);
    }
    /**
     * Creates a MerklePath instance from a binary array.
     *
     * @static
     * @param {number[]} bump - The binary array representation of the Merkle Path.
     * @returns {MerklePath} - A new MerklePath instance.
     */
    static fromBinary(bump) {
      const reader = new ReaderUint8Array(bump);
      return _MerklePath.fromReader(reader);
    }
    /**
     *
     * @static fromCoinbaseTxid
     *
     * Creates a MerklePath instance for a coinbase transaction in an empty block.
     * This edge case is difficult to retrieve from standard APIs.
     *
     * @param {string} txid - The coinbase txid.
     * @param {number} height - The height of the block.
     * @returns {MerklePath} - A new MerklePath instance which assumes the tx is in a block with no other transactions.
     */
    static fromCoinbaseTxidAndHeight(txid, height) {
      return new _MerklePath(height, [[{ offset: 0, hash: txid, txid: true }]]);
    }
    /**
     * Serializes the MerklePath to the writer provided.
     *
     * @param writer - The writer to which the Merkle Path will be serialized.
     */
    toWriter(writer) {
      writer.writeVarIntNum(this.blockHeight);
      const treeHeight = this.path.length;
      writer.writeUInt8(treeHeight);
      for (let level = 0; level < treeHeight; level++) {
        const nLeaves = Object.keys(this.path[level]).length;
        writer.writeVarIntNum(nLeaves);
        for (const leaf of this.path[level]) {
          writer.writeVarIntNum(leaf.offset);
          let flags = 0;
          if (leaf?.duplicate === true) {
            flags |= 1;
          }
          if (leaf?.txid !== void 0 && leaf.txid !== null) {
            flags |= 2;
          }
          writer.writeUInt8(flags);
          if ((flags & 1) === 0) {
            writer.write(toArray2(leaf.hash, "hex").reverse());
          }
        }
      }
    }
    /**
     * Converts the MerklePath to a binary array format.
     *
     * @returns {number[]} - The binary array representation of the Merkle Path.
     */
    toBinary() {
      const writer = new Writer();
      this.toWriter(writer);
      return writer.toArray();
    }
    /**
     * Converts the MerklePath to a binary array format.
     *
     * @returns {Uint8Array} - The binary array representation of the Merkle Path.
     */
    toBinaryUint8Array() {
      const writer = new WriterUint8Array();
      this.toWriter(writer);
      return writer.toUint8Array();
    }
    /**
     * Converts the MerklePath to a hexadecimal string format.
     *
     * @returns {string} - The hexadecimal string representation of the Merkle Path.
     */
    toHex() {
      return toHex(this.toBinaryUint8Array());
    }
    //
    indexOf(txid) {
      const leaf = this.path[0].find((l) => l.hash === txid);
      if (leaf === null || leaf === void 0) {
        throw new Error(`Transaction ID ${txid} not found in the Merkle Path`);
      }
      return leaf.offset;
    }
    /**
     * Computes the Merkle root from the provided transaction ID.
     *
     * @param {string} txid - The transaction ID to compute the Merkle root for. If not provided, the root will be computed from an unspecified branch, and not all branches will be validated!
     * @returns {string} - The computed Merkle root as a hexadecimal string.
     * @throws {Error} - If the transaction ID is not part of the Merkle Path.
     */
    computeRoot(txid) {
      if (typeof txid !== "string") {
        const foundLeaf = this.path[0].find((leaf) => Boolean(leaf?.hash));
        if (foundLeaf == null) {
          throw new Error("No valid leaf found in the Merkle Path");
        }
        txid = foundLeaf.hash;
      }
      if (typeof txid !== "string") {
        throw new TypeError("Transaction ID is undefined");
      }
      const index = this.indexOf(txid);
      const hash = (m) => toHex(hash256(toArray2(m, "hex").reverse()).reverse());
      let workingHash = txid;
      if (this.path.length === 1 && this.path[0].length === 1)
        return workingHash;
      const maxOffset = this.path[0].reduce((max, l) => Math.max(max, l.offset), 0);
      const treeHeight = Math.max(this.path.length, 32 - Math.clz32(maxOffset));
      for (let height = 0; height < treeHeight; height++) {
        const offset = index >> height ^ 1;
        const leaf = this.findOrComputeLeaf(height, offset);
        if (typeof leaf !== "object") {
          if (this.path.length === 1 && index >> height === maxOffset >> height) {
            workingHash = hash((workingHash ?? "") + (workingHash ?? ""));
            continue;
          }
          throw new Error(`Missing hash for index ${index} at height ${height}`);
        } else if (leaf.duplicate === true) {
          workingHash = hash((workingHash ?? "") + (workingHash ?? ""));
        } else if (offset % 2 === 1) {
          workingHash = hash((leaf.hash ?? "") + (workingHash ?? ""));
        } else {
          workingHash = hash((workingHash ?? "") + (leaf.hash ?? ""));
        }
      }
      return workingHash;
    }
    /**
     * Find leaf with `offset` at `height` or compute from level below, recursively.
     *
     * Does not add computed leaves to path.
     *
     * @param height
     * @param offset
     */
    findOrComputeLeaf(height, offset) {
      const hash = (m) => toHex(hash256(toArray2(m, "hex").reverse()).reverse());
      let leaf = height < this.path.length ? this.path[height].find((l2) => l2.offset === offset) : void 0;
      if (leaf != null)
        return leaf;
      if (height === 0)
        return void 0;
      const h = height - 1;
      const l = offset << 1;
      const leaf0 = this.findOrComputeLeaf(h, l);
      if (leaf0?.hash == null || leaf0.hash === "")
        return void 0;
      const leaf1 = this.findOrComputeLeaf(h, l + 1);
      if (leaf1?.hash == null) {
        if (leaf1?.duplicate === true) {
          return { offset, hash: hash(leaf0.hash + leaf0.hash) };
        }
        if (this.path.length === 1) {
          const maxOffset0 = this.path[0].reduce((max, lf) => Math.max(max, lf.offset), 0);
          if (l === maxOffset0 >> h) {
            return { offset, hash: hash(leaf0.hash + leaf0.hash) };
          }
        }
        return void 0;
      }
      let workinghash;
      if (leaf1.duplicate === true) {
        workinghash = hash(leaf0.hash + leaf0.hash);
      } else {
        workinghash = hash((leaf1.hash ?? "") + (leaf0.hash ?? ""));
      }
      leaf = {
        offset,
        hash: workinghash
      };
      return leaf;
    }
    /**
     * Verifies if the given transaction ID is part of the Merkle tree at the specified block height.
     *
     * @param {string} txid - The transaction ID to verify.
     * @param {ChainTracker} chainTracker - The ChainTracker instance used to verify the Merkle root.
     * @returns {boolean} - True if the transaction ID is valid within the Merkle Path at the specified block height.
     */
    async verify(txid, chainTracker) {
      const root = this.computeRoot(txid);
      if (this.indexOf(txid) === 0) {
        const height = await chainTracker.currentHeight();
        if (this.blockHeight + 100 > height) {
          return false;
        }
      }
      return await chainTracker.isValidRootForHeight(root, this.blockHeight);
    }
    /**
     * Combines this MerklePath with another to create a compound proof.
     *
     * @param {MerklePath} other - Another MerklePath to combine with this path.
     * @throws {Error} - If the paths have different block heights or roots.
     */
    combine(other) {
      if (this.blockHeight !== other.blockHeight) {
        throw new Error("You cannot combine paths which do not have the same block height.");
      }
      const root1 = this.computeRoot();
      const root2 = other.computeRoot();
      if (root1 !== root2) {
        throw new Error("You cannot combine paths which do not have the same root.");
      }
      const combinedPath = [];
      for (let h = 0; h < this.path.length; h++) {
        combinedPath.push([]);
        for (const leaf of this.path[h]) {
          combinedPath[h].push(leaf);
        }
        for (const otherLeaf of other.path[h]) {
          const existingLeaf = combinedPath[h].find((leaf) => leaf.offset === otherLeaf.offset);
          if (existingLeaf === void 0) {
            combinedPath[h].push(otherLeaf);
          } else if (otherLeaf?.txid !== void 0 && otherLeaf?.txid !== null) {
            existingLeaf.txid = true;
          }
        }
      }
      this.path = combinedPath;
      this.trim();
    }
    /**
     * Remove all internal nodes that are not required by level zero txid nodes.
     * Assumes that at least all required nodes are present.
     * Leaves all levels sorted by increasing offset.
     */
    trim() {
      const pushIfNew = (v, a) => {
        if (a.length === 0 || a.at(-1) !== v) {
          a.push(v);
        }
      };
      const dropOffsetsFromLevel = (dropOffsets2, level) => {
        for (let i = dropOffsets2.length; i >= 0; i--) {
          const l = this.path[level].findIndex((n) => n.offset === dropOffsets2[i]);
          if (l >= 0) {
            this.path[level].splice(l, 1);
          }
        }
      };
      const nextComputedOffsets = (cos) => {
        const ncos = [];
        for (const o of cos) {
          pushIfNew(o >> 1, ncos);
        }
        return ncos;
      };
      let computedOffsets = [];
      let dropOffsets = [];
      for (const level of this.path) {
        level.sort((a, b) => a.offset - b.offset);
      }
      for (let l = 0; l < this.path[0].length; l++) {
        const n = this.path[0][l];
        if (n.txid === true) {
          pushIfNew(n.offset >> 1, computedOffsets);
        } else {
          const isOdd = n.offset % 2 === 1;
          const peer = this.path[0][l + (isOdd ? -1 : 1)];
          if (peer.txid === void 0 || peer.txid === null || !peer.txid) {
            pushIfNew(peer.offset, dropOffsets);
          }
        }
      }
      dropOffsetsFromLevel(dropOffsets, 0);
      for (let h = 1; h < this.path.length; h++) {
        dropOffsets = computedOffsets;
        computedOffsets = nextComputedOffsets(computedOffsets);
        dropOffsetsFromLevel(dropOffsets, h);
      }
    }
    /**
     * Cached leaf finder for extract(). Uses Map-based indexes for O(1) lookups
     * and caches computed intermediate hashes to avoid redundant work.
     */
    cachedFindLeaf(height, offset, sourceIndex, hashCache, maxOffset) {
      const key2 = `${height}:${offset}`;
      if (hashCache.has(key2))
        return hashCache.get(key2);
      const doHash = (m) => toHex(hash256(toArray2(m, "hex").reverse()).reverse());
      let leaf = height < sourceIndex.length ? sourceIndex[height].get(offset) : void 0;
      if (leaf != null) {
        hashCache.set(key2, leaf);
        return leaf;
      }
      if (height === 0) {
        hashCache.set(key2, void 0);
        return void 0;
      }
      const h = height - 1;
      const l = offset << 1;
      const leaf0 = this.cachedFindLeaf(h, l, sourceIndex, hashCache, maxOffset);
      if (leaf0?.hash == null || leaf0.hash === "") {
        hashCache.set(key2, void 0);
        return void 0;
      }
      const leaf1 = this.cachedFindLeaf(h, l + 1, sourceIndex, hashCache, maxOffset);
      if (leaf1?.hash == null) {
        if (leaf1?.duplicate === true || this.path.length === 1 && l === maxOffset >> h) {
          leaf = { offset, hash: doHash(leaf0.hash + leaf0.hash) };
          hashCache.set(key2, leaf);
          return leaf;
        }
        hashCache.set(key2, void 0);
        return void 0;
      }
      const workinghash = leaf1.duplicate === true ? doHash(leaf0.hash + leaf0.hash) : doHash((leaf1.hash ?? "") + (leaf0.hash ?? ""));
      leaf = { offset, hash: workinghash };
      hashCache.set(key2, leaf);
      return leaf;
    }
    /**
     * Extracts a minimal compound MerklePath covering only the specified transaction IDs.
     *
     * Given a compound MerklePath (e.g. all block txids at level 0, or a trimmed
     * compound path), this method reconstructs the sibling hashes at each tree level
     * for every requested txid using cached Map-indexed lookups, then assembles them
     * into a single trimmed compound path.
     *
     * The extracted path is verified to compute the same Merkle root as the source.
     *
     * @param {string[]} txids - Transaction IDs to extract proofs for.
     * @returns {MerklePath} - A new trimmed compound MerklePath covering only the requested txids.
     * @throws {Error} - If no txids are provided, a txid is not found, or the roots do not match.
     *
     * @example
     * // Full block compound path (all txids at level 0)
     * const fullBlock = new MerklePath(height, [allTxidsAtLevel0])
     * // Extract a smaller compound proof covering just two transactions
     * const twoTxProof = fullBlock.extract([txid1, txid2])
     * twoTxProof.computeRoot(txid1) // === fullBlock.computeRoot()
     */
    extract(txids) {
      if (txids.length === 0) {
        throw new Error("At least one txid must be provided to extract");
      }
      const originalRoot = this.computeRoot();
      const maxOffset = this.path[0].reduce((max, l) => Math.max(max, l.offset), 0);
      const treeHeight = Math.max(this.path.length, 32 - Math.clz32(maxOffset));
      const sourceIndex = new Array(this.path.length);
      for (let h = 0; h < this.path.length; h++) {
        const map = /* @__PURE__ */ new Map();
        for (const leaf of this.path[h])
          map.set(leaf.offset, leaf);
        sourceIndex[h] = map;
      }
      const hashCache = /* @__PURE__ */ new Map();
      const txidToOffset = /* @__PURE__ */ new Map();
      for (const leaf of this.path[0]) {
        if (leaf.hash != null)
          txidToOffset.set(leaf.hash, leaf.offset);
      }
      const neededPerLevel = new Array(treeHeight);
      for (let h = 0; h < treeHeight; h++)
        neededPerLevel[h] = /* @__PURE__ */ new Map();
      for (const txid of txids) {
        const txOffset = txidToOffset.get(txid);
        if (txOffset === void 0) {
          throw new Error(`Transaction ID ${txid} not found in the Merkle Path`);
        }
        neededPerLevel[0].set(txOffset, { offset: txOffset, txid: true, hash: txid });
        const sib0Offset = txOffset ^ 1;
        if (!neededPerLevel[0].has(sib0Offset)) {
          const sib = this.cachedFindLeaf(0, sib0Offset, sourceIndex, hashCache, maxOffset);
          if (sib != null)
            neededPerLevel[0].set(sib0Offset, sib);
        }
        for (let h = 1; h < treeHeight; h++) {
          const sibOffset = txOffset >> h ^ 1;
          if (neededPerLevel[h].has(sibOffset))
            continue;
          const sib = this.cachedFindLeaf(h, sibOffset, sourceIndex, hashCache, maxOffset);
          if (sib != null) {
            neededPerLevel[h].set(sibOffset, sib);
          } else if (txOffset >> h === maxOffset >> h) {
            neededPerLevel[h].set(sibOffset, { offset: sibOffset, duplicate: true });
          }
        }
      }
      const compoundPath = new Array(treeHeight);
      for (let h = 0; h < treeHeight; h++) {
        compoundPath[h] = Array.from(neededPerLevel[h].values()).sort((a, b) => a.offset - b.offset);
      }
      const compound = new _MerklePath(this.blockHeight, compoundPath);
      compound.trim();
      const extractedRoot = compound.computeRoot();
      if (extractedRoot !== originalRoot) {
        throw new Error(`Extracted path root ${extractedRoot} does not match original root ${originalRoot}`);
      }
      return compound;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/transaction/BeefConstants.js
  var BEEF_V1 = 4022206465;
  var BEEF_V2 = 4022206466;
  var ATOMIC_BEEF = 16843009;
  var TX_DATA_FORMAT;
  (function(TX_DATA_FORMAT2) {
    TX_DATA_FORMAT2[TX_DATA_FORMAT2["RAWTX"] = 0] = "RAWTX";
    TX_DATA_FORMAT2[TX_DATA_FORMAT2["RAWTX_AND_BUMP_INDEX"] = 1] = "RAWTX_AND_BUMP_INDEX";
    TX_DATA_FORMAT2[TX_DATA_FORMAT2["TXID_ONLY"] = 2] = "TXID_ONLY";
  })(TX_DATA_FORMAT || (TX_DATA_FORMAT = {}));

  // node_modules/@bsv/sdk/dist/esm/src/transaction/BeefTx.js
  var BeefTx = class _BeefTx {
    /**
     * @param tx If string, must be a valid txid. If `number[]` must be a valid serialized transaction.
     * @param bumpIndex If transaction already has a proof in the beef to which it will be added.
     */
    constructor(tx, bumpIndex) {
      __publicField(this, "_bumpIndex");
      __publicField(this, "_tx");
      __publicField(this, "_rawTx");
      __publicField(this, "_txid");
      __publicField(this, "inputTxids", []);
      /**
       * true if `hasProof` or all inputs chain to `hasProof`.
       *
       * Typically set by sorting transactions by proven dependency chains.
       */
      __publicField(this, "isValid");
      if (typeof tx === "string") {
        this._txid = tx;
      } else if (tx instanceof Uint8Array) {
        this._rawTx = tx;
      } else if (Array.isArray(tx)) {
        this._rawTx = new Uint8Array(tx);
      } else if (tx instanceof Transaction) {
        this._tx = tx;
      } else {
        throw new TypeError("Invalid transaction data type");
      }
      this.bumpIndex = bumpIndex;
      this.updateInputTxids();
    }
    get bumpIndex() {
      return this._bumpIndex;
    }
    set bumpIndex(v) {
      this._bumpIndex = v;
      this.updateInputTxids();
    }
    get hasProof() {
      return this._bumpIndex !== void 0;
    }
    get isTxidOnly() {
      return this._txid !== void 0 && this._txid !== null && this._rawTx == null && this._tx == null;
    }
    get txid() {
      if (this._txid !== void 0 && this._txid !== null && this._txid !== "")
        return this._txid;
      if (this._tx != null) {
        this._txid = this._tx.id("hex");
        return this._txid;
      }
      if (this._rawTx != null) {
        this._txid = toHex(hash256(this._rawTx));
        return this._txid;
      }
      throw new Error("Internal");
    }
    get tx() {
      if (this._tx != null)
        return this._tx;
      if (this._rawTx != null) {
        this._tx = Transaction.fromBinary(this._rawTx);
        return this._tx;
      }
      return void 0;
    }
    /**
     * Raw transaction bytes, if available as number[]
     */
    get rawTx() {
      if (this._rawTx != null) {
        return Array.from(this._rawTx);
      }
      if (this._tx != null) {
        const bytes2 = this._tx.toUint8Array();
        this._rawTx = bytes2;
        return Array.from(bytes2);
      }
      return void 0;
    }
    /**
     * Raw transaction bytes, if available as Uint8Array
     */
    get rawTxUint8Array() {
      if (this._rawTx != null)
        return this._rawTx;
      if (this._tx != null) {
        this._rawTx = this._tx.toUint8Array();
        return this._rawTx;
      }
      return void 0;
    }
    static fromTx(tx, bumpIndex) {
      return new _BeefTx(tx, bumpIndex);
    }
    static fromRawTx(rawTx, bumpIndex) {
      return new _BeefTx(rawTx, bumpIndex);
    }
    static fromTxid(txid, bumpIndex) {
      return new _BeefTx(txid, bumpIndex);
    }
    updateInputTxids() {
      if (this.hasProof || this.tx == null) {
        this.inputTxids = [];
      } else {
        const inputTxids = /* @__PURE__ */ new Set();
        for (const input of this.tx.inputs) {
          if (input.sourceTXID !== void 0 && input.sourceTXID !== null && input.sourceTXID !== "") {
            inputTxids.add(input.sourceTXID);
          }
        }
        this.inputTxids = Array.from(inputTxids);
      }
    }
    toWriter(writer, version) {
      const writeByte = (bb) => {
        writer.writeUInt8(bb);
      };
      const writeTxid = () => {
        if (this._txid == null) {
          throw new Error("Transaction ID (_txid) is undefined");
        }
        writer.writeReverse(toArray2(this._txid, "hex"));
      };
      const writeTx = () => {
        const bytes2 = this.rawTxUint8Array;
        if (bytes2 == null) {
          throw new Error("a valid serialized Transaction is expected");
        }
        writer.write(bytes2);
      };
      const writeBumpIndex = () => {
        if (this.bumpIndex === void 0) {
          writeByte(TX_DATA_FORMAT.RAWTX);
        } else {
          writeByte(TX_DATA_FORMAT.RAWTX_AND_BUMP_INDEX);
          writer.writeVarIntNum(this.bumpIndex);
        }
      };
      if (version === BEEF_V2) {
        if (this.isTxidOnly) {
          writeByte(TX_DATA_FORMAT.TXID_ONLY);
          writeTxid();
        } else if (this.bumpIndex !== void 0) {
          writeByte(TX_DATA_FORMAT.RAWTX_AND_BUMP_INDEX);
          writer.writeVarIntNum(this.bumpIndex);
          writeTx();
        } else {
          writeByte(TX_DATA_FORMAT.RAWTX);
          writeTx();
        }
      } else {
        writeTx();
        writeBumpIndex();
      }
    }
    static fromReader(br, version) {
      let data;
      let bumpIndex;
      let beefTx;
      if (version === BEEF_V2) {
        const format = br.readUInt8();
        if (format === TX_DATA_FORMAT.TXID_ONLY) {
          beefTx = _BeefTx.fromTxid(toHex(br.readReverse(32)));
        } else {
          if (format === TX_DATA_FORMAT.RAWTX_AND_BUMP_INDEX) {
            bumpIndex = br.readVarIntNum();
          }
          data = Transaction.fromReader(br);
          beefTx = _BeefTx.fromTx(data, bumpIndex);
        }
      } else {
        data = Transaction.fromReader(br);
        bumpIndex = br.readUInt8() === 0 ? void 0 : br.readVarIntNum();
        beefTx = _BeefTx.fromTx(data, bumpIndex);
      }
      return beefTx;
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/transaction/Beef.js
  var Beef = class _Beef {
    constructor(version = BEEF_V2) {
      __publicField(this, "bumps", []);
      __publicField(this, "txs", []);
      __publicField(this, "version", BEEF_V2);
      __publicField(this, "atomicTxid");
      __publicField(this, "txidIndex");
      __publicField(this, "rawBytesCache");
      __publicField(this, "hexCache");
      __publicField(this, "needsSort", true);
      this.version = version;
    }
    invalidateSerializationCaches() {
      this.rawBytesCache = void 0;
      this.hexCache = void 0;
    }
    markMutated(requiresSort = true) {
      this.invalidateSerializationCaches();
      if (requiresSort) {
        this.needsSort = true;
      }
    }
    ensureSerializableState() {
      for (const tx of this.txs) {
        tx.txid;
      }
    }
    ensureSortedForSerialization() {
      if (this.needsSort) {
        this.sortTxs();
      }
    }
    getSerializedBytes() {
      this.ensureSerializableState();
      if (this.rawBytesCache == null) {
        this.ensureSortedForSerialization();
        const writer = new WriterUint8Array();
        this.toWriter(writer);
        this.rawBytesCache = writer.toUint8Array();
      }
      return this.rawBytesCache;
    }
    getBeefForAtomic(txid) {
      if (this.needsSort) {
        this.sortTxs();
      }
      const tx = this.findTxid(txid);
      if (tx == null) {
        throw new Error(`${txid} does not exist in this Beef`);
      }
      const beef = this.txs.at(-1) === tx ? this : this.clone();
      if (beef !== this) {
        const i = this.txs.findIndex((t) => t.txid === txid);
        beef.txs.splice(i + 1);
      }
      const writer = new WriterUint8Array();
      writer.writeUInt32LE(ATOMIC_BEEF);
      writer.writeReverse(toArray2(txid, "hex"));
      return { beef, writer };
    }
    /**
     * @param txid of `beefTx` to find
     * @returns `BeefTx` in `txs` with `txid`.
     */
    findTxid(txid) {
      return this.ensureTxidIndex().get(txid);
    }
    ensureTxidIndex() {
      if (this.txidIndex == null) {
        this.txidIndex = /* @__PURE__ */ new Map();
        for (const tx of this.txs) {
          this.txidIndex.set(tx.txid, tx);
        }
      }
      return this.txidIndex;
    }
    deleteFromIndex(txid) {
      this.txidIndex?.delete(txid);
    }
    addToIndex(tx) {
      this.txidIndex?.set(tx.txid, tx);
    }
    /**
     * Replaces `BeefTx` for this txid with txidOnly.
     *
     * Replacement is done so that a `clone()` can be
     * updated by this method without affecting the
     * original.
     *
     * @param txid
     * @returns undefined if txid is unknown.
     */
    makeTxidOnly(txid) {
      const i = this.txs.findIndex((tx) => tx.txid === txid);
      if (i === -1)
        return void 0;
      let btx = this.txs[i];
      if (btx.isTxidOnly) {
        return btx;
      }
      this.deleteFromIndex(txid);
      this.txs.splice(i, 1);
      this.markMutated(true);
      btx = this.mergeTxidOnly(txid);
      return btx;
    }
    /**
     * @returns `MerklePath` with level zero hash equal to txid or undefined.
     */
    findBump(txid) {
      return this.bumps.find((b) => b.path[0].some((leaf) => leaf.hash === txid));
    }
    /**
     * Finds a Transaction in this `Beef`
     * and adds any missing input SourceTransactions from this `Beef`.
     *
     * The result is suitable for signing.
     *
     * @param txid The id of the target transaction.
     * @returns Transaction with all available input `SourceTransaction`s from this Beef.
     */
    findTransactionForSigning(txid) {
      const beefTx = this.findTxid(txid);
      if (beefTx == null || beefTx.tx == null)
        return void 0;
      for (const i of beefTx.tx.inputs) {
        if (i.sourceTransaction == null) {
          const itx = this.findTxid(verifyNotNull(i.sourceTXID, "sourceTXID must be valid"));
          if (itx != null) {
            i.sourceTransaction = itx.tx;
          }
        }
      }
      return beefTx.tx;
    }
    /**
     * Builds the proof tree rooted at a specific `Transaction`.
     *
     * To succeed, the Beef must contain all the required transaction and merkle path data.
     *
     * @param txid The id of the target transaction.
     * @returns Transaction with input `SourceTransaction` and `MerklePath` populated from this Beef.
     */
    findAtomicTransaction(txid) {
      const beefTx = this.findTxid(txid);
      if (beefTx == null || beefTx.tx == null)
        return void 0;
      this.addInputProof(beefTx.tx);
      return beefTx.tx;
    }
    /** Recursively attach merkle paths and source transactions to all inputs. */
    addInputProof(tx) {
      const mp = this.findBump(tx.id("hex"));
      if (mp != null) {
        tx.merklePath = mp;
        return;
      }
      for (const i of tx.inputs) {
        this.resolveInputSource(i);
        if (i.sourceTransaction != null) {
          this.attachMerklePathOrRecurse(i.sourceTransaction);
        }
      }
    }
    resolveInputSource(i) {
      if (i.sourceTransaction == null) {
        const itx = this.findTxid(verifyNotNull(i.sourceTXID, "sourceTXID must be valid"));
        if (itx != null) {
          i.sourceTransaction = itx.tx;
        }
      }
    }
    attachMerklePathOrRecurse(sourceTx) {
      const mp = this.findBump(sourceTx.id("hex"));
      if (mp != null) {
        sourceTx.merklePath = mp;
      } else {
        this.addInputProof(sourceTx);
      }
    }
    /**
     * Merge a MerklePath that is assumed to be fully valid.
     * @param bump
     * @returns index of merged bump
     */
    mergeBump(bump) {
      this.markMutated(false);
      const bumpIndex = this.findOrInsertBump(bump);
      const b = this.bumps[bumpIndex];
      for (const tx of this.txs) {
        if (tx.bumpIndex == null) {
          this.tryMarkTxProvenByBump(tx, b, bumpIndex);
        }
      }
      return bumpIndex;
    }
    /**
     * Find an existing compatible bump or insert a new one; return its index.
     */
    findOrInsertBump(bump) {
      for (let i = 0; i < this.bumps.length; i++) {
        const b = this.bumps[i];
        if (b === bump)
          return i;
        if (b.blockHeight !== bump.blockHeight)
          continue;
        if (b.computeRoot() === bump.computeRoot()) {
          b.combine(bump);
          return i;
        }
      }
      this.bumps.push(bump);
      return this.bumps.length - 1;
    }
    /** If bump's level-0 path contains tx's txid, record the bumpIndex on tx. */
    tryMarkTxProvenByBump(tx, b, bumpIndex) {
      const txid = tx.txid;
      for (const n of b.path[0]) {
        if (n.hash === txid) {
          tx.bumpIndex = bumpIndex;
          n.txid = true;
          break;
        }
      }
    }
    /**
     * Merge a serialized transaction.
     *
     * Checks that a transaction with the same txid hasn't already been merged.
     *
     * Replaces existing transaction with same txid.
     *
     * @param rawTx
     * @param bumpIndex Optional. If a number, must be valid index into bumps array.
     * @returns txid of rawTx
     */
    mergeRawTx(rawTx, bumpIndex) {
      this.markMutated(true);
      const newTx = new BeefTx(rawTx, bumpIndex);
      this.removeExistingTxid(newTx.txid);
      this.txs.push(newTx);
      this.addToIndex(newTx);
      this.tryToValidateBumpIndex(newTx);
      return newTx;
    }
    /**
     * Merge a `Transaction` and any referenced `merklePath` and `sourceTransaction`, recursifely.
     *
     * Replaces existing transaction with same txid.
     *
     * Attempts to match an existing bump to the new transaction.
     *
     * @param tx
     * @returns txid of tx
     */
    mergeTransaction(tx) {
      this.markMutated(true);
      const txid = tx.id("hex");
      this.removeExistingTxid(txid);
      let bumpIndex;
      if (tx.merklePath != null) {
        bumpIndex = this.mergeBump(tx.merklePath);
      }
      const newTx = new BeefTx(tx, bumpIndex);
      this.txs.push(newTx);
      this.addToIndex(newTx);
      this.tryToValidateBumpIndex(newTx);
      bumpIndex = newTx.bumpIndex;
      if (bumpIndex === void 0) {
        for (const input of tx.inputs) {
          if (input.sourceTransaction != null) {
            this.mergeTransaction(input.sourceTransaction);
          }
        }
      }
      return newTx;
    }
    /**
     * Removes an existing transaction from the BEEF, given its TXID
     * @param txid TXID of the transaction to remove
     */
    removeExistingTxid(txid) {
      const existingTxIndex = this.txs.findIndex((t) => t.txid === txid);
      if (existingTxIndex >= 0) {
        this.deleteFromIndex(txid);
        this.txs.splice(existingTxIndex, 1);
        this.markMutated(true);
      }
    }
    mergeTxidOnly(txid) {
      let tx = this.findTxid(txid);
      if (tx == null) {
        tx = new BeefTx(txid);
        this.txs.push(tx);
        this.addToIndex(tx);
        this.tryToValidateBumpIndex(tx);
        this.markMutated(true);
      }
      return tx;
    }
    mergeBeefTx(btx) {
      let beefTx = this.findTxid(btx.txid);
      if (btx.isTxidOnly && beefTx == null) {
        beefTx = this.mergeTxidOnly(btx.txid);
      } else if (btx._tx != null && (beefTx == null || beefTx.isTxidOnly)) {
        beefTx = this.mergeTransaction(btx._tx);
      } else if (btx._rawTx != null && (beefTx == null || beefTx.isTxidOnly)) {
        beefTx = this.mergeRawTx(btx._rawTx);
      }
      if (beefTx == null) {
        throw new Error(`Failed to merge BeefTx for txid: ${btx.txid}`);
      }
      return beefTx;
    }
    mergeBeef(beef) {
      const b = beef instanceof _Beef ? beef : _Beef.fromBinary(beef);
      for (const bump of b.bumps) {
        this.mergeBump(bump);
      }
      for (const tx of b.txs) {
        this.mergeBeefTx(tx);
      }
    }
    /**
     * Sorts `txs` and checks structural validity of beef.
     *
     * Does NOT verify merkle roots.
     *
     * Validity requirements:
     * 1. No 'known' txids, unless `allowTxidOnly` is true.
     * 2. All transactions have bumps or their inputs chain back to bumps (or are known).
     * 3. Order of transactions satisfies dependencies before dependents.
     * 4. No transactions with duplicate txids.
     *
     * @param allowTxidOnly optional. If true, transaction txid only is assumed valid
     */
    isValid(allowTxidOnly) {
      return this.verifyValid(allowTxidOnly).valid;
    }
    /**
     * Sorts `txs` and confirms validity of transaction data contained in beef
     * by validating structure of this beef and confirming computed merkle roots
     * using `chainTracker`.
     *
     * Validity requirements:
     * 1. No 'known' txids, unless `allowTxidOnly` is true.
     * 2. All transactions have bumps or their inputs chain back to bumps (or are known).
     * 3. Order of transactions satisfies dependencies before dependents.
     * 4. No transactions with duplicate txids.
     *
     * @param chainTracker Used to verify computed merkle path roots for all bump txids.
     * @param allowTxidOnly optional. If true, transaction txid is assumed valid
     */
    async verify(chainTracker, allowTxidOnly) {
      const r2 = this.verifyValid(allowTxidOnly);
      if (!r2.valid)
        return false;
      for (const height of Object.keys(r2.roots)) {
        const isValid = await chainTracker.isValidRootForHeight(r2.roots[height], Number(height));
        if (!isValid) {
          return false;
        }
      }
      return true;
    }
    /**
     * Sorts `txs` and confirms validity of transaction data contained in beef
     * by validating structure of this beef.
     *
     * Returns block heights and merkle root values to be confirmed by a chaintracker.
     *
     * Validity requirements:
     * 1. No 'known' txids, unless `allowTxidOnly` is true.
     * 2. All transactions have bumps or their inputs chain back to bumps (or are known).
     * 3. Order of transactions satisfies dependencies before dependents.
     * 4. No transactions with duplicate txids.
     *
     * @param allowTxidOnly optional. If true, transaction txid is assumed valid
     * @returns {{valid: boolean, roots: Record<number, string>}}
     * `valid` is true iff this Beef is structuraly valid.
     * `roots` is a record where keys are block heights and values are the corresponding merkle roots to be validated.
     */
    verifyValid(allowTxidOnly) {
      const r2 = {
        valid: false,
        roots: {}
      };
      const sr = this.sortTxs();
      if (sr.missingInputs.length > 0 || sr.notValid.length > 0 || sr.txidOnly.length > 0 && allowTxidOnly !== true || sr.withMissingInputs.length > 0) {
        return r2;
      }
      const txids = {};
      if (!this.collectTxidOnlyTxids(txids, allowTxidOnly))
        return r2;
      if (!this.collectBumpTxids(txids, r2))
        return r2;
      if (!this.verifyBumpIndexLeaves())
        return r2;
      if (!this.verifyInputDependencies(txids))
        return r2;
      r2.valid = true;
      return r2;
    }
    /** Add txidOnly transaction txids; return false if not allowed. */
    collectTxidOnlyTxids(txids, allowTxidOnly) {
      for (const tx of this.txs) {
        if (!tx.isTxidOnly)
          continue;
        if (allowTxidOnly !== true)
          return false;
        txids[tx.txid] = true;
      }
      return true;
    }
    /**
     * Record txids proven by bumps; validate all bump roots agree per block height.
     * Returns false if any root conflict is detected.
     */
    collectBumpTxids(txids, r2) {
      for (const b of this.bumps) {
        for (const n of b.path[0]) {
          if (n.txid !== true || typeof n.hash !== "string" || n.hash.length === 0)
            continue;
          txids[n.hash] = true;
          if (!this.confirmComputedRoot(b, n.hash, r2))
            return false;
        }
      }
      return true;
    }
    /** Verify that every tx with a bumpIndex has a matching txid leaf in its bump. */
    verifyBumpIndexLeaves() {
      for (const t of this.txs) {
        if (t.bumpIndex === void 0)
          continue;
        const leaf = this.bumps[t.bumpIndex].path[0].find((l) => l.hash === t.txid);
        if (leaf == null)
          return false;
      }
      return true;
    }
    /** Verify all input txids appear before the spending tx in sorted order. */
    verifyInputDependencies(txids) {
      for (const t of this.txs) {
        for (const i of t.inputTxids) {
          if (!txids[i])
            return false;
        }
        txids[t.txid] = true;
      }
      return true;
    }
    /** Confirm the computed merkle root for txid in bump matches previously accepted root for that height. */
    confirmComputedRoot(b, txid, r2) {
      const root = b.computeRoot(txid);
      if (r2.roots[b.blockHeight] === void 0 || r2.roots[b.blockHeight] === "") {
        r2.roots[b.blockHeight] = root;
      }
      return r2.roots[b.blockHeight] === root;
    }
    /**
     * Serializes this data to `writer`
     * @param writer
     */
    toWriter(writer) {
      writer.writeUInt32LE(this.version);
      writer.writeVarIntNum(this.bumps.length);
      for (const b of this.bumps) {
        writer.write(b.toBinary());
      }
      writer.writeVarIntNum(this.txs.length);
      for (const tx of this.txs) {
        tx.toWriter(writer, this.version);
      }
    }
    /**
     * Returns a binary array representing the serialized BEEF
     * @returns A binary array representing the BEEF
     * @returns An array of byte values containing binary serialization of the BEEF
     */
    toBinary() {
      return Array.from(this.getSerializedBytes());
    }
    /**
     * Returns a binary array representing the serialized BEEF
     * @returns A Uint8Array containing binary serialization of the BEEF
     */
    toUint8Array() {
      return this.getSerializedBytes();
    }
    /**
     * Serialize this Beef as AtomicBEEF.
     *
     * `txid` must exist
     *
     * after sorting, if txid is not last txid, creates a clone and removes newer txs
     *
     * @param txid
     * @returns serialized contents of this Beef with AtomicBEEF prefix.
     */
    toBinaryAtomic(txid) {
      const { beef, writer } = this.getBeefForAtomic(txid);
      beef.toWriter(writer);
      return writer.toArray();
    }
    /**
     * Serialize this Beef as AtomicBEEF.
     *
     * `txid` must exist
     *
     * after sorting, if txid is not last txid, creates a clone and removes newer txs
     *
     * @param txid
     * @returns serialized contents of this Beef with AtomicBEEF prefix.
     */
    toUint8ArrayAtomic(txid) {
      const { beef, writer } = this.getBeefForAtomic(txid);
      const beefUint8 = beef.getSerializedBytes();
      const prefix = writer.toUint8Array();
      const atomic = new Uint8Array(prefix.length + beefUint8.length);
      atomic.set(prefix, 0);
      atomic.set(beefUint8, prefix.length);
      return atomic;
    }
    /**
     * Returns a hex string representing the serialized BEEF
     * @returns A hex string representing the BEEF
     */
    toHex() {
      if (this.hexCache != null) {
        return this.hexCache;
      }
      const bytes2 = this.getSerializedBytes();
      const hex = toHex(bytes2);
      this.hexCache = hex;
      return hex;
    }
    static fromReader(br) {
      let version = br.readUInt32LE();
      let atomicTxid;
      if (version === ATOMIC_BEEF) {
        atomicTxid = toHex(br.readReverse(32));
        version = br.readUInt32LE();
      }
      if (version !== BEEF_V1 && version !== BEEF_V2) {
        throw new Error(`Serialized BEEF must start with ${BEEF_V1} or ${BEEF_V2} but starts with ${version}`);
      }
      const beef = new _Beef(version);
      const bumpsLength = br.readVarIntNum();
      for (let i = 0; i < bumpsLength; i++) {
        const bump = MerklePath.fromReader(br, false);
        beef.bumps.push(bump);
      }
      const txsLength = br.readVarIntNum();
      for (let i = 0; i < txsLength; i++) {
        const beefTx = BeefTx.fromReader(br, version);
        beef.txs.push(beefTx);
      }
      beef.atomicTxid = atomicTxid;
      return beef;
    }
    /**
     * Constructs an instance of the Beef class based on the provided binary array
     * @param bin The binary array or Uint8Array from which to construct BEEF
     * @returns An instance of the Beef class constructed from the binary data
     */
    static fromBinary(bin) {
      const br = ReaderUint8Array.makeReader(bin);
      return _Beef.fromReader(br);
    }
    /**
     * Constructs an instance of the Beef class based on the provided string
     * @param s The string value from which to construct BEEF
     * @param enc The encoding of the string value from which BEEF should be constructed
     * @returns An instance of the Beef class constructed from the string
     */
    static fromString(s2, enc = "hex") {
      const bin = toUint8Array(s2, enc);
      const br = new ReaderUint8Array(bin);
      return _Beef.fromReader(br);
    }
    /**
     * Try to validate newTx.bumpIndex by looking for an existing bump
     * that proves newTx.txid
     *
     * @param newTx A new `BeefTx` that has been added to this.txs
     * @returns true if a bump was found, false otherwise
     */
    tryToValidateBumpIndex(newTx) {
      if (newTx.bumpIndex !== void 0) {
        return true;
      }
      const txid = newTx.txid;
      for (let i = 0; i < this.bumps.length; i++) {
        const j = this.bumps[i].path[0].findIndex((b) => b.hash === txid);
        if (j >= 0) {
          newTx.bumpIndex = i;
          this.bumps[i].path[0][j].txid = true;
          return true;
        }
      }
      return false;
    }
    /**
     * Sort the `txs` by input txid dependency order:
     * - Oldest Tx Anchored by Path or txid only
     * - Newer Txs depending on Older parents
     * - Newest Tx
     *
     * with proof (MerklePath) last, longest chain of dependencies first
     *
     * @returns `{ missingInputs, notValid, valid, withMissingInputs }`
     */
    sortTxs() {
      const validTxids = {};
      const txidToTx = {};
      const result = [];
      const txidOnly = [];
      let queue = this.partitionTxs(txidToTx, validTxids, result, txidOnly);
      const { txsMissingInputs, missingInputs, remaining } = this.separateMissingInputs(queue, txidToTx);
      queue = remaining;
      const txsNotValid = this.topoSort(queue, validTxids, result);
      this.txs = txsMissingInputs.concat(txsNotValid).concat(txidOnly).concat(result);
      this.needsSort = false;
      this.invalidateSerializationCaches();
      return {
        missingInputs: Object.keys(missingInputs),
        notValid: txsNotValid.map((tx) => tx.txid),
        valid: Object.keys(validTxids),
        withMissingInputs: txsMissingInputs.map((tx) => tx.txid),
        txidOnly: txidOnly.map((tx) => tx.txid)
      };
    }
    /**
     * Partition txs into proven (result), txidOnly, and a queue of the rest.
     * Populates txidToTx and validTxids as side-effects.
     */
    partitionTxs(txidToTx, validTxids, result, txidOnly) {
      const queue = [];
      for (const tx of this.txs) {
        txidToTx[tx.txid] = tx;
        tx.isValid = tx.hasProof;
        if (tx.isValid) {
          validTxids[tx.txid] = true;
          result.push(tx);
        } else if (tx.isTxidOnly && tx.inputTxids.length === 0) {
          validTxids[tx.txid] = true;
          txidOnly.push(tx);
        } else {
          queue.push(tx);
        }
      }
      return queue;
    }
    /**
     * Separate queue entries that have at least one input txid not present in txidToTx.
     */
    separateMissingInputs(candidates, txidToTx) {
      const missingInputs = {};
      const txsMissingInputs = [];
      const remaining = [];
      for (const tx of candidates) {
        let hasMissingInput = false;
        for (const inputTxid of tx.inputTxids) {
          if (txidToTx[inputTxid] === void 0) {
            missingInputs[inputTxid] = true;
            hasMissingInput = true;
          }
        }
        if (hasMissingInput) {
          txsMissingInputs.push(tx);
        } else {
          remaining.push(tx);
        }
      }
      return { txsMissingInputs, missingInputs, remaining };
    }
    /**
     * Topologically sort queue into result; return anything that cannot be sorted.
     */
    topoSort(queue, validTxids, result) {
      while (queue.length > 0) {
        const oldQueue = queue;
        queue = [];
        for (const tx of oldQueue) {
          if (tx.inputTxids.every((txid) => validTxids[txid])) {
            validTxids[tx.txid] = true;
            result.push(tx);
          } else {
            queue.push(tx);
          }
        }
        if (oldQueue.length === queue.length)
          break;
      }
      return queue;
    }
    /**
     * @returns a shallow copy of this beef
     */
    clone() {
      const c = new _Beef();
      c.version = this.version;
      c.bumps = Array.from(this.bumps);
      c.txs = Array.from(this.txs);
      c.txidIndex = void 0;
      c.needsSort = this.needsSort;
      c.hexCache = this.hexCache;
      c.rawBytesCache = this.rawBytesCache;
      return c;
    }
    /**
     * Ensure that all the txids in `knownTxids` are txidOnly
     * @param knownTxids
     */
    trimKnownTxids(knownTxids) {
      let mutated = this.removeKnownTxidOnlyTxs(knownTxids);
      mutated = this.reindexBumps() || mutated;
      if (mutated) {
        this.markMutated(true);
      }
    }
    /** Remove txidOnly entries that appear in knownTxids; return true if any were removed. */
    removeKnownTxidOnlyTxs(knownTxids) {
      let mutated = false;
      for (let i = 0; i < this.txs.length; ) {
        const tx = this.txs[i];
        if (tx.isTxidOnly && knownTxids.includes(tx.txid)) {
          this.deleteFromIndex(tx.txid);
          this.txs.splice(i, 1);
          mutated = true;
        } else {
          i++;
        }
      }
      return mutated;
    }
    /**
     * Remove bumps that are no longer referenced by any tx and update bumpIndex references.
     * Returns true if any bumps were removed.
     */
    reindexBumps() {
      const referencedBumpIndices = /* @__PURE__ */ new Set();
      for (const tx of this.txs) {
        if (tx.bumpIndex !== void 0) {
          referencedBumpIndices.add(tx.bumpIndex);
        }
      }
      if (referencedBumpIndices.size >= this.bumps.length)
        return false;
      const indexMap = /* @__PURE__ */ new Map();
      let newIndex = 0;
      for (let i = 0; i < this.bumps.length; i++) {
        if (referencedBumpIndices.has(i)) {
          indexMap.set(i, newIndex);
          newIndex++;
        }
      }
      this.bumps = this.bumps.filter((_, i) => referencedBumpIndices.has(i));
      for (const tx of this.txs) {
        if (tx.bumpIndex === void 0)
          continue;
        const mapped = indexMap.get(tx.bumpIndex);
        if (mapped === void 0) {
          throw new Error(`Internal error: bumpIndex ${tx.bumpIndex} not found in indexMap`);
        }
        tx.bumpIndex = mapped;
      }
      return true;
    }
    /**
     * @returns array of transaction txids that either have a proof or whose inputs chain back to a proven transaction.
     */
    getValidTxids() {
      const r2 = this.sortTxs();
      return r2.valid;
    }
    /**
     * @returns Summary of `Beef` contents as multi-line string.
     */
    toLogString() {
      let log = "";
      log += `BEEF with ${this.bumps.length} BUMPS and ${this.txs.length} Transactions, isValid ${this.isValid().toString()}
`;
      let i = -1;
      for (const b of this.bumps) {
        i++;
        log += `  BUMP ${i}
    block: ${b.blockHeight}
    txids: [
${b.path[0].filter((n) => n.txid === true).map((n) => `      '${n.hash ?? ""}'`).join(",\n")}
    ]
`;
      }
      i = -1;
      for (const t of this.txs) {
        i++;
        log += `  TX ${i}
    txid: ${t.txid}
`;
        if (t.bumpIndex !== void 0) {
          log += `    bumpIndex: ${t.bumpIndex}
`;
        }
        if (t.isTxidOnly) {
          log += "    txidOnly\n";
        } else {
          log += `    rawTx length=${t.rawTx?.length ?? 0}
`;
        }
        if (t.inputTxids.length > 0) {
          log += `    inputs: [
${t.inputTxids.map((it) => `      '${it}'`).join(",\n")}
    ]
`;
        }
      }
      return log;
    }
    /**
    * In some circumstances it may be helpful for the BUMP MerklePaths to include
    * leaves that can be computed from row zero.
    */
    addComputedLeaves() {
      for (const bump of this.bumps) {
        for (let row = 1; row < bump.path.length; row++) {
          this.addComputedLeavesForRow(bump, row);
        }
      }
    }
    /** Add any missing computable leaf at `row` derived from two known leaves at `row - 1`. */
    addComputedLeavesForRow(bump, row) {
      const hashPair = (m) => toHex(hash256(toArray2(m, "hex").reverse()).reverse());
      for (const leafL of bump.path[row - 1]) {
        if (typeof leafL.hash !== "string" || (leafL.offset & 1) !== 0)
          continue;
        const leafR = bump.path[row - 1].find((l) => l.offset === leafL.offset + 1);
        if (leafR === void 0 || typeof leafR.hash !== "string")
          continue;
        const offsetOnRow = leafL.offset >> 1;
        if (bump.path[row].every((l) => l.offset !== offsetOnRow)) {
          bump.path[row].push({
            offset: offsetOnRow,
            // String concatenation puts the right leaf on the left of the left leaf hash
            hash: hashPair(leafR.hash + leafL.hash)
          });
        }
      }
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/transaction/Transaction.js
  var Transaction = class _Transaction {
    constructor(version = 1, inputs = [], outputs = [], lockTime = 0, metadata = /* @__PURE__ */ new Map(), merklePath) {
      __publicField(this, "version");
      __publicField(this, "inputs");
      __publicField(this, "outputs");
      __publicField(this, "lockTime");
      __publicField(this, "metadata");
      __publicField(this, "merklePath");
      __publicField(this, "cachedHash");
      __publicField(this, "rawBytesCache");
      __publicField(this, "hexCache");
      this.version = version;
      this.inputs = inputs;
      this.outputs = outputs;
      this.lockTime = lockTime;
      this.metadata = metadata;
      this.merklePath = merklePath;
    }
    // Recursive function for adding merkle proofs or input transactions
    static addPathOrInputs(obj, transactions, BUMPs) {
      if (typeof obj.pathIndex === "number") {
        const path = BUMPs[obj.pathIndex];
        if (typeof path !== "object") {
          throw new TypeError("Invalid merkle path index found in BEEF!");
        }
        obj.tx.merklePath = path;
      } else {
        for (const input of obj.tx.inputs) {
          if (input.sourceTXID === void 0) {
            throw new Error("Input sourceTXID is undefined");
          }
          const sourceObj = transactions[input.sourceTXID];
          if (typeof sourceObj !== "object") {
            throw new TypeError(`Reference to unknown TXID in BEEF: ${input.sourceTXID ?? "undefined"}`);
          }
          input.sourceTransaction = sourceObj.tx;
          this.addPathOrInputs(sourceObj, transactions, BUMPs);
        }
      }
    }
    /**
     * Creates a new transaction, linked to its inputs and their associated merkle paths, from a BEEF V1, V2 or Atomic.
     * Optionally, you can provide a specific TXID to retrieve a particular transaction from the BEEF data.
     * If the TXID is provided but not found in the BEEF data, an error will be thrown.
     * If no TXID is provided, the last transaction in the BEEF data is returned, or the atomic txid.
     * @param beef A binary representation of transactions in BEEF format.
     * @param txid Optional TXID of the transaction to retrieve from the BEEF data.
     * @returns An anchored transaction, linked to its associated inputs populated with merkle paths.
     */
    static fromBEEF(beef, txid) {
      const { tx } = _Transaction.fromAnyBeef(beef, txid);
      return tx;
    }
    /**
     * Creates a new transaction from an Atomic BEEF (BRC-95) structure.
     * Extracts the subject transaction and supporting merkle path and source transactions contained in the BEEF data
     *
     * @param beef A binary representation of an Atomic BEEF structure.
     * @returns The subject transaction, linked to its associated inputs populated with merkle paths.
     */
    static fromAtomicBEEF(beef) {
      const { tx, txid, beef: b } = _Transaction.fromAnyBeef(beef);
      if (txid !== b.atomicTxid) {
        if (b.atomicTxid == null) {
          throw new Error("beef must conform to BRC-95 and must contain the subject txid.");
        } else {
          throw new Error(`Transaction with TXID ${b.atomicTxid} not found in BEEF data.`);
        }
      }
      return tx;
    }
    static fromAnyBeef(beef, txid) {
      const b = Beef.fromBinary(beef);
      if (b.txs.length < 1) {
        throw new Error("beef must include at least one transaction.");
      }
      const lastTx = b.txs.at(-1);
      if (lastTx == null) {
        throw new Error("beef must include at least one transaction.");
      }
      const target = txid ?? b.atomicTxid ?? lastTx.txid;
      const tx = b.findAtomicTransaction(target);
      if (tx == null) {
        if (txid == null) {
          throw new Error("beef does not contain transaction for atomic txid.");
        } else {
          throw new Error(`Transaction with TXID ${String(target)} not found in BEEF data.`);
        }
      }
      return { tx, beef: b, txid: target };
    }
    /**
     * Creates a new transaction, linked to its inputs and their associated merkle paths, from a EF (BRC-30) structure.
     * @param ef A binary representation of a transaction in EF format.
     * @returns An extended transaction, linked to its associated inputs by locking script and satoshis amounts only.
     */
    static fromEF(ef) {
      const br = ReaderUint8Array.makeReader(ef);
      const version = br.readUInt32LE();
      if (toHex(br.read(6)) !== "0000000000ef") {
        throw new Error("Invalid EF marker");
      }
      const inputsLength = br.readVarIntNum();
      const inputs = [];
      for (let i = 0; i < inputsLength; i++) {
        const sourceTXID = toHex(br.readReverse(32));
        const sourceOutputIndex = br.readUInt32LE();
        const scriptLength = br.readVarIntNum();
        const scriptBin = br.read(scriptLength);
        const unlockingScript = UnlockingScript.fromBinary(scriptBin);
        const sequence = br.readUInt32LE();
        const satoshis = br.readUInt64LEBn().toNumber();
        const lockingScriptLength = br.readVarIntNum();
        const lockingScriptBin = br.read(lockingScriptLength);
        const lockingScript = LockingScript.fromBinary(lockingScriptBin);
        const sourceTransaction = new _Transaction(void 0, [], [], void 0);
        sourceTransaction.outputs = new Array(sourceOutputIndex + 1).fill(null);
        sourceTransaction.outputs[sourceOutputIndex] = {
          satoshis,
          lockingScript
        };
        inputs.push({
          sourceTransaction,
          sourceTXID,
          sourceOutputIndex,
          unlockingScript,
          sequence
        });
      }
      const outputsLength = br.readVarIntNum();
      const outputs = [];
      for (let i = 0; i < outputsLength; i++) {
        const satoshis = br.readUInt64LEBn().toNumber();
        const scriptLength = br.readVarIntNum();
        const scriptBin = br.read(scriptLength);
        const lockingScript = LockingScript.fromBinary(scriptBin);
        outputs.push({
          satoshis,
          lockingScript
        });
      }
      const lockTime = br.readUInt32LE();
      return new _Transaction(version, inputs, outputs, lockTime);
    }
    /**
     * Since the validation of blockchain data is atomically transaction data validation,
     * any application seeking to validate data in output scripts must store the entire transaction as well.
     * Since the transaction data includes the output script data, saving a second copy of potentially
     * large scripts can bloat application storage requirements.
     *
     * This function efficiently parses binary transaction data to determine the offsets and lengths of each script.
     * This supports the efficient retreival of script data from transaction data.
     *
     * @param bin binary transaction data
     * @returns {
     *   inputs: { vin: number, offset: number, length: number }[]
     *   outputs: { vout: number, offset: number, length: number }[]
     * }
     */
    static parseScriptOffsets(bin) {
      const br = ReaderUint8Array.makeReader(bin);
      const inputs = [];
      const outputs = [];
      br.pos += 4;
      const inputsLength = br.readVarIntNum();
      for (let i = 0; i < inputsLength; i++) {
        br.pos += 36;
        const scriptLength = br.readVarIntNum();
        inputs.push({ vin: i, offset: br.pos, length: scriptLength });
        br.pos += scriptLength + 4;
      }
      const outputsLength = br.readVarIntNum();
      for (let i = 0; i < outputsLength; i++) {
        br.pos += 8;
        const scriptLength = br.readVarIntNum();
        outputs.push({ vout: i, offset: br.pos, length: scriptLength });
        br.pos += scriptLength;
      }
      return { inputs, outputs };
    }
    static fromReader(br) {
      const version = br.readUInt32LE();
      const inputsLength = br.readVarIntNum();
      const inputs = [];
      for (let i = 0; i < inputsLength; i++) {
        const sourceTXID = toHex(br.readReverse(32));
        const sourceOutputIndex = br.readUInt32LE();
        const scriptLength = br.readVarIntNum();
        const scriptBin = br.read(scriptLength);
        const unlockingScript = UnlockingScript.fromBinary(scriptBin);
        const sequence = br.readUInt32LE();
        inputs.push({
          sourceTXID,
          sourceOutputIndex,
          unlockingScript,
          sequence
        });
      }
      const outputsLength = br.readVarIntNum();
      const outputs = [];
      for (let i = 0; i < outputsLength; i++) {
        const satoshis = br.readUInt64LEBn().toNumber();
        const scriptLength = br.readVarIntNum();
        const scriptBin = br.read(scriptLength);
        const lockingScript = LockingScript.fromBinary(scriptBin);
        outputs.push({
          satoshis,
          lockingScript
        });
      }
      const lockTime = br.readUInt32LE();
      return new _Transaction(version, inputs, outputs, lockTime);
    }
    /**
     * Creates a Transaction instance from a binary array.
     *
     * @static
     * @param {number[]} bin - The binary array representation of the transaction.
     * @returns {Transaction} - A new Transaction instance.
     */
    static fromBinary(bin) {
      const copy = bin.slice();
      const rawBytes = Uint8Array.from(copy);
      const br = new ReaderUint8Array(rawBytes);
      const tx = _Transaction.fromReader(br);
      tx.rawBytesCache = rawBytes;
      return tx;
    }
    /**
     * Creates a Transaction instance from a hexadecimal string.
     *
     * @static
     * @param {string} hex - The hexadecimal string representation of the transaction.
     * @returns {Transaction} - A new Transaction instance.
     */
    static fromHex(hex) {
      const rawBytes = toUint8Array(hex, "hex");
      const br = new ReaderUint8Array(rawBytes);
      const tx = _Transaction.fromReader(br);
      tx.rawBytesCache = rawBytes;
      tx.hexCache = toHex(rawBytes);
      return tx;
    }
    /**
     * Creates a Transaction instance from a hexadecimal string encoded EF.
     *
     * @static
     * @param {string} hex - The hexadecimal string representation of the transaction EF.
     * @returns {Transaction} - A new Transaction instance.
     */
    static fromHexEF(hex) {
      return _Transaction.fromEF(toUint8Array(hex, "hex"));
    }
    /**
     * Creates a Transaction instance from a hexadecimal string encoded BEEF.
     * Optionally, you can provide a specific TXID to retrieve a particular transaction from the BEEF data.
     * If the TXID is provided but not found in the BEEF data, an error will be thrown.
     * If no TXID is provided, the last transaction in the BEEF data is returned.
     *
     * @static
     * @param {string} hex - The hexadecimal string representation of the transaction BEEF.
     * @param {string} [txid] - Optional TXID of the transaction to retrieve from the BEEF data.
     * @returns {Transaction} - A new Transaction instance.
     */
    static fromHexBEEF(hex, txid) {
      return _Transaction.fromBEEF(toArray2(hex, "hex"), txid);
    }
    invalidateSerializationCaches() {
      this.cachedHash = void 0;
      this.rawBytesCache = void 0;
      this.hexCache = void 0;
    }
    /**
     * Adds a new input to the transaction.
     *
     * @param {TransactionInput} input - The TransactionInput object to add to the transaction.
     * @throws {Error} - If the input does not have a sourceTXID or sourceTransaction defined.
     */
    addInput(input) {
      if (input.sourceTXID === void 0 && input.sourceTransaction === void 0) {
        throw new TypeError("A reference to an an input transaction is required. If the input transaction itself cannot be referenced, its TXID must still be provided.");
      }
      input.sequence ?? (input.sequence = 4294967295);
      this.invalidateSerializationCaches();
      this.inputs.push(input);
    }
    /**
     * Adds a new output to the transaction.
     *
     * @param {TransactionOutput} output - The TransactionOutput object to add to the transaction.
     */
    addOutput(output) {
      this.cachedHash = void 0;
      if (output.change !== true) {
        if (output.satoshis === void 0) {
          throw new TypeError("either satoshis must be defined or change must be set to true");
        }
        if (output.satoshis < 0) {
          throw new Error("satoshis must be a positive integer or zero");
        }
      }
      if (output.lockingScript == null)
        throw new Error("lockingScript must be defined");
      this.outputs.push(output);
    }
    /**
     * Adds a new P2PKH output to the transaction.
     *
     * @param {number[] | string} address - The P2PKH address of the output.
     * @param {number} [satoshis] - The number of satoshis to send to the address - if not provided, the output is considered a change output.
     *
     */
    addP2PKHOutput(address2, satoshis) {
      const lockingScript = new P2PKH().lock(address2);
      if (satoshis === void 0) {
        return this.addOutput({ lockingScript, change: true });
      }
      this.addOutput({
        lockingScript,
        satoshis
      });
    }
    /**
     * Updates the transaction's metadata.
     *
     * @param {Record<string, any>} metadata - The metadata object to merge into the existing metadata.
     */
    updateMetadata(metadata) {
      this.metadata = {
        ...this.metadata,
        ...metadata
      };
    }
    /**
     * Computes fees prior to signing.
     * If no fee model is provided, uses a LivePolicy fee model that fetches current rates from ARC.
     * If fee is a number, the transaction uses that value as fee.
     *
     * @param modelOrFee - The initialized fee model to use or fixed fee for the transaction
     * @param changeDistribution - Specifies how the change should be distributed
     * amongst the change outputs
     *
     */
    async fee(modelOrFee = LivePolicy.getInstance(), changeDistribution = "equal") {
      this.invalidateSerializationCaches();
      if (typeof modelOrFee === "number") {
        const sats = modelOrFee;
        modelOrFee = {
          computeFee: async () => sats
        };
      }
      const fee = await modelOrFee.computeFee(this);
      const change = this.calculateChange(fee);
      if (change <= 0) {
        this.outputs = this.outputs.filter((output) => output.change !== true);
        return;
      }
      this.distributeChange(change, changeDistribution);
    }
    calculateChange(fee) {
      let change = 0;
      for (const input of this.inputs) {
        if (typeof input.sourceTransaction !== "object") {
          throw new TypeError("Source transactions are required for all inputs during fee computation");
        }
        change += input.sourceTransaction.outputs[input.sourceOutputIndex].satoshis ?? 0;
      }
      change -= fee;
      for (const out of this.outputs) {
        if (out.change !== true) {
          if (out.satoshis !== void 0) {
            change -= out.satoshis;
          }
        }
      }
      return change;
    }
    distributeChange(change, changeDistribution) {
      let distributedChange = 0;
      const changeOutputs = this.outputs.filter((out) => out.change);
      if (changeDistribution === "random") {
        distributedChange = this.distributeRandomChange(change, changeOutputs);
      } else if (changeDistribution === "equal") {
        distributedChange = this.distributeEqualChange(change, changeOutputs);
      }
      if (distributedChange < change) {
        const lastOutput = this.outputs.at(-1);
        if (lastOutput.satoshis === void 0) {
          lastOutput.satoshis = change - distributedChange;
        } else {
          lastOutput.satoshis += change - distributedChange;
        }
      }
    }
    distributeRandomChange(change, changeOutputs) {
      let distributedChange = 0;
      let changeToUse = change;
      const benfordNumbers = new Array(changeOutputs.length).fill(1);
      changeToUse -= changeOutputs.length;
      distributedChange += changeOutputs.length;
      for (let i = 0; i < changeOutputs.length - 1; i++) {
        const portion = this.benfordNumber(0, changeToUse);
        benfordNumbers[i] = benfordNumbers[i] + portion;
        distributedChange += portion;
        changeToUse -= portion;
      }
      for (const output of this.outputs) {
        if (output.change === true)
          output.satoshis = benfordNumbers.shift();
      }
      return distributedChange;
    }
    distributeEqualChange(change, changeOutputs) {
      let distributedChange = 0;
      const perOutput = Math.floor(change / changeOutputs.length);
      for (const out of changeOutputs) {
        distributedChange += perOutput;
        out.satoshis = perOutput;
      }
      return distributedChange;
    }
    benfordNumber(min, max) {
      const d = Random_default(1)[0] % 9 + 1;
      return Math.floor(min + (max - min) * Math.log10(1 + 1 / d) / Math.log10(10));
    }
    /**
     * Utility method that returns the current fee based on inputs and outputs
     *
     * @returns The current transaction fee
     */
    getFee() {
      let totalIn = 0;
      for (const input of this.inputs) {
        if (typeof input.sourceTransaction !== "object") {
          throw new TypeError("Source transactions or sourceSatoshis are required for all inputs to calculate fee");
        }
        totalIn += input.sourceTransaction.outputs[input.sourceOutputIndex].satoshis ?? 0;
      }
      let totalOut = 0;
      for (const output of this.outputs) {
        totalOut += output.satoshis ?? 0;
      }
      return totalIn - totalOut;
    }
    /**
     * Signs a transaction, hydrating all its unlocking scripts based on the provided script templates where they are available.
     */
    async sign() {
      this.invalidateSerializationCaches();
      for (const out of this.outputs) {
        if (out.satoshis === void 0) {
          if (out.change === true) {
            throw new Error("There are still change outputs with uncomputed amounts. Use the fee() method to compute the change amounts and transaction fees prior to signing.");
          } else {
            throw new Error("One or more transaction outputs is missing an amount. Ensure all output amounts are provided before signing.");
          }
        }
      }
      const unlockingScripts = await Promise.all(this.inputs.map(async (x, i) => {
        if (typeof this.inputs[i].unlockingScriptTemplate === "object") {
          return await this.inputs[i]?.unlockingScriptTemplate?.sign(this, i);
        } else {
          return await Promise.resolve(void 0);
        }
      }));
      for (let i = 0, l = this.inputs.length; i < l; i++) {
        if (typeof this.inputs[i].unlockingScriptTemplate === "object") {
          this.inputs[i].unlockingScript = unlockingScripts[i];
        }
      }
    }
    /**
     * Broadcasts a transaction.
     *
     * @param broadcaster The Broadcaster instance wwhere the transaction will be sent
     * @returns A BroadcastResponse or BroadcastFailure from the Broadcaster
     */
    async broadcast(broadcaster = defaultBroadcaster()) {
      return await broadcaster.broadcast(this);
    }
    writeTransactionBody(writer) {
      writer.writeUInt32LE(this.version);
      writer.writeVarIntNum(this.inputs.length);
      for (const i of this.inputs) {
        if (i.sourceTXID === void 0) {
          if (i.sourceTransaction == null) {
            throw new Error("sourceTransaction is undefined");
          } else {
            writer.write(i.sourceTransaction.hash());
          }
        } else {
          writer.writeReverse(toArray2(i.sourceTXID, "hex"));
        }
        writer.writeUInt32LE(i.sourceOutputIndex);
        if (i.unlockingScript == null) {
          throw new Error("unlockingScript is undefined");
        }
        const scriptBin = i.unlockingScript.toUint8Array();
        writer.writeVarIntNum(scriptBin.length);
        writer.write(scriptBin);
        writer.writeUInt32LE(i.sequence ?? 4294967295);
      }
      writer.writeVarIntNum(this.outputs.length);
      for (const o of this.outputs) {
        writer.writeUInt64LE(o.satoshis ?? 0);
        const scriptBin = o.lockingScript.toUint8Array();
        writer.writeVarIntNum(scriptBin.length);
        writer.write(scriptBin);
      }
      writer.writeUInt32LE(this.lockTime);
    }
    buildSerializedBytes() {
      const writer = new WriterUint8Array();
      this.writeTransactionBody(writer);
      return writer.toUint8Array();
    }
    getSerializedBytes() {
      this.rawBytesCache ?? (this.rawBytesCache = this.buildSerializedBytes());
      return this.rawBytesCache;
    }
    /**
     * Converts the transaction to a binary array format.
     *
     * @returns {number[]} - The binary array representation of the transaction.
     */
    toBinary() {
      return Array.from(this.getSerializedBytes());
    }
    toUint8Array() {
      return this.getSerializedBytes();
    }
    writeEF(writer) {
      writer.writeUInt32LE(this.version);
      writer.write([0, 0, 0, 0, 0, 239]);
      writer.writeVarIntNum(this.inputs.length);
      for (const i of this.inputs) {
        if (i.sourceTransaction === void 0) {
          throw new TypeError("All inputs must have source transactions when serializing to EF format");
        }
        if (i.sourceTXID === void 0) {
          writer.write(i.sourceTransaction.hash());
        } else {
          writer.write(toArray2(i.sourceTXID, "hex").reverse());
        }
        writer.writeUInt32LE(i.sourceOutputIndex);
        if (i.unlockingScript == null) {
          throw new Error("unlockingScript is undefined");
        }
        const scriptBin = i.unlockingScript.toBinary();
        writer.writeVarIntNum(scriptBin.length);
        writer.write(scriptBin);
        writer.writeUInt32LE(i.sequence ?? 4294967295);
        writer.writeUInt64LE(i.sourceTransaction.outputs[i.sourceOutputIndex].satoshis ?? 0);
        const lockingScriptBin = i.sourceTransaction.outputs[i.sourceOutputIndex].lockingScript.toBinary();
        writer.writeVarIntNum(lockingScriptBin.length);
        writer.write(lockingScriptBin);
      }
      writer.writeVarIntNum(this.outputs.length);
      for (const o of this.outputs) {
        writer.writeUInt64LE(o.satoshis ?? 0);
        const scriptBin = o.lockingScript.toBinary();
        writer.writeVarIntNum(scriptBin.length);
        writer.write(scriptBin);
      }
      writer.writeUInt32LE(this.lockTime);
    }
    /**
     * Converts the transaction to a BRC-30 EF format.
     *
     * @returns {number[]} - The BRC-30 EF representation of the transaction.
     */
    toEF() {
      const writer = new Writer();
      this.writeEF(writer);
      return writer.toArray();
    }
    /**
     * Converts the transaction to a BRC-30 EF format.
     *
     * @returns {Uint8Array} - The BRC-30 EF representation of the transaction.
     */
    toEFUint8Array() {
      const writer = new WriterUint8Array();
      this.writeEF(writer);
      return writer.toUint8Array();
    }
    /**
     * Converts the transaction to a hexadecimal string EF.
     *
     * @returns {string} - The hexadecimal string representation of the transaction EF.
     */
    toHexEF() {
      return toHex(this.toEFUint8Array());
    }
    /**
     * Converts the transaction to a hexadecimal string format.
     *
     * @returns {string} - The hexadecimal string representation of the transaction.
     */
    toHex() {
      if (this.hexCache != null) {
        return this.hexCache;
      }
      const bytes2 = this.getSerializedBytes();
      const hex = toHex(bytes2);
      this.hexCache = hex;
      return hex;
    }
    /**
     * Converts the transaction to a hexadecimal string BEEF.
     *
     * @returns {string} - The hexadecimal string representation of the transaction BEEF.
     */
    toHexBEEF() {
      return toHex(this.toBEEF());
    }
    /**
     * Converts the transaction to a hexadecimal string Atomic BEEF.
     *
     * @returns {string} - The hexadecimal string representation of the transaction Atomic BEEF.
     */
    toHexAtomicBEEF() {
      return toHex(this.toAtomicBEEF());
    }
    /**
     * Calculates the transaction's hash.
     *
     * @param {'hex' | undefined} enc - The encoding to use for the hash. If 'hex', returns a hexadecimal string; otherwise returns a binary array.
     * @returns {string | number[]} - The hash of the transaction in the specified format.
     */
    hash(enc) {
      this.cachedHash ?? (this.cachedHash = hash256(this.getSerializedBytes()));
      if (enc === "hex") {
        return toHex(this.cachedHash);
      }
      return this.cachedHash;
    }
    /**
     * Calculates the transaction's ID.
     *
     * @param {'hex' | undefined} enc - The encoding to use for the ID. If 'hex', returns a hexadecimal string; otherwise returns a binary array.
     * @returns {string | number[]} - The ID of the transaction in the specified format.
     */
    id(enc) {
      const id = [...this.hash()];
      id.reverse();
      if (enc === "hex") {
        return toHex(id);
      }
      return id;
    }
    /**
     * Verifies the legitimacy of the Bitcoin transaction according to the rules of SPV by ensuring all the input transactions link back to valid block headers, the chain of spends for all inputs are valid, and the sum of inputs is not less than the sum of outputs.
     *
     * @param chainTracker - An instance of ChainTracker, a Bitcoin block header tracker. If the value is set to 'scripts only', headers will not be verified. If not provided then the default chain tracker will be used.
     * @param feeModel - An instance of FeeModel, a fee model to use for fee calculation. If not provided then the default fee model will be used.
     * @param memoryLimit - The maximum memory in bytes usage allowed for script evaluation. If not provided then the default memory limit will be used.
     *
     * @returns Whether the transaction is valid according to the rules of SPV.
     *
     * @example tx.verify(new WhatsOnChain(), LivePolicy.getInstance())
     */
    async verify(chainTracker = defaultChainTracker(), feeModel, memoryLimit) {
      const verifiedTxids = /* @__PURE__ */ new Set();
      const txQueue = [this];
      while (txQueue.length > 0) {
        const tx = txQueue.shift();
        const txid = tx?.id("hex") ?? "";
        if (txid != null && txid !== "" && verifiedTxids.has(txid)) {
          continue;
        }
        if (typeof tx?.merklePath === "object") {
          if (chainTracker === "scripts only") {
            if (txid != null) {
              verifiedTxids.add(txid);
            }
            continue;
          } else {
            const proofValid = await tx.merklePath.verify(txid, chainTracker);
            if (proofValid) {
              verifiedTxids.add(txid);
              continue;
            } else {
              throw new Error(`Invalid merkle path for transaction ${txid}`);
            }
          }
        }
        if (feeModel !== void 0) {
          if (tx === void 0) {
            throw new Error("Transaction is undefined");
          }
          const cpTx = _Transaction.fromEF(tx.toEF());
          delete cpTx.outputs[0].satoshis;
          cpTx.outputs[0].change = true;
          await cpTx.fee(feeModel);
          if (tx.getFee() < cpTx.getFee()) {
            throw new Error(`Verification failed because the transaction ${txid} has an insufficient fee and has not been mined.`);
          }
        }
        let inputTotal = 0;
        if (tx === void 0) {
          throw new Error("Transaction is undefined");
        }
        for (let i = 0; i < tx.inputs.length; i++) {
          const input = tx.inputs[i];
          if (typeof input.sourceTransaction !== "object") {
            throw new TypeError(`Verification failed because the input at index ${i} of transaction ${txid} is missing an associated source transaction. This source transaction is required for transaction verification because there is no merkle proof for the transaction spending a UTXO it contains.`);
          }
          if (typeof input.unlockingScript !== "object") {
            throw new TypeError(`Verification failed because the input at index ${i} of transaction ${txid} is missing an associated unlocking script. This script is required for transaction verification because there is no merkle proof for the transaction spending the UTXO.`);
          }
          const sourceOutput = input.sourceTransaction.outputs[input.sourceOutputIndex];
          inputTotal += sourceOutput.satoshis ?? 0;
          const sourceTxid = input.sourceTransaction.id("hex");
          if (!verifiedTxids.has(sourceTxid)) {
            txQueue.push(input.sourceTransaction);
          }
          const otherInputs = tx.inputs.filter((_, idx) => idx !== i);
          input.sourceTXID ?? (input.sourceTXID = sourceTxid);
          const spend = new Spend({
            sourceTXID: input.sourceTXID,
            sourceOutputIndex: input.sourceOutputIndex,
            lockingScript: sourceOutput.lockingScript,
            sourceSatoshis: sourceOutput.satoshis ?? 0,
            transactionVersion: tx.version,
            otherInputs,
            unlockingScript: input.unlockingScript,
            inputSequence: input.sequence ?? 4294967295,
            // default to max sequence
            inputIndex: i,
            outputs: tx.outputs,
            lockTime: tx.lockTime,
            memoryLimit
          });
          const spendValid = spend.validate();
          if (!spendValid) {
            return false;
          }
        }
        let outputTotal = 0;
        for (const out of tx.outputs) {
          if (typeof out.satoshis !== "number") {
            throw new TypeError("Every output must have a defined amount during transaction verification.");
          }
          outputTotal += out.satoshis;
        }
        if (outputTotal > inputTotal) {
          return false;
        }
        verifiedTxids.add(txid);
      }
      return true;
    }
    /**
     * Serializes this transaction, together with its inputs and the respective merkle proofs, into the BEEF (BRC-62) format. This enables efficient verification of its compliance with the rules of SPV.
     *
     * @param writer The writer to serialize to
     * @param allowPartial If true, error will not be thrown if there are any missing sourceTransactions.
     *
     * @returns The serialized BEEF structure
     * @throws Error if there are any missing sourceTransactions unless `allowPartial` is true.
     */
    writeSerializedBEEF(writer, allowPartial) {
      writer.writeUInt32LE(BEEF_V1);
      const BUMPs = [];
      const bumpIndexByInstance = /* @__PURE__ */ new Map();
      const bumpIndexByRoot = /* @__PURE__ */ new Map();
      const txs = [];
      const seenTxids = /* @__PURE__ */ new Set();
      const getBumpIndex = (merklePath) => {
        const existingByInstance = bumpIndexByInstance.get(merklePath);
        if (existingByInstance !== void 0) {
          return existingByInstance;
        }
        const key2 = `${merklePath.blockHeight}:${merklePath.computeRoot()}`;
        const existingByRoot = bumpIndexByRoot.get(key2);
        if (existingByRoot !== void 0) {
          BUMPs[existingByRoot].combine(merklePath);
          bumpIndexByInstance.set(merklePath, existingByRoot);
          return existingByRoot;
        }
        const newIndex = BUMPs.length;
        BUMPs.push(merklePath);
        bumpIndexByInstance.set(merklePath, newIndex);
        bumpIndexByRoot.set(key2, newIndex);
        return newIndex;
      };
      const addPathsAndInputs = (tx) => {
        const txid = tx.id("hex");
        if (seenTxids.has(txid)) {
          return;
        }
        const obj = { tx };
        const merklePath = tx.merklePath;
        const hasProof = typeof merklePath === "object";
        if (hasProof && merklePath != null) {
          obj.pathIndex = getBumpIndex(merklePath);
        }
        if (!hasProof) {
          for (let i = tx.inputs.length - 1; i >= 0; i--) {
            const input = tx.inputs[i];
            if (typeof input.sourceTransaction === "object") {
              addPathsAndInputs(input.sourceTransaction);
            } else if (allowPartial === false) {
              throw new Error("A required source transaction is missing!");
            }
          }
        }
        seenTxids.add(txid);
        txs.push(obj);
      };
      addPathsAndInputs(this);
      writer.writeVarIntNum(BUMPs.length);
      for (const b of BUMPs) {
        writer.write(b.toBinary());
      }
      writer.writeVarIntNum(txs.length);
      for (const t of txs) {
        writer.write(t.tx.toBinary());
        if (typeof t.pathIndex === "number") {
          writer.writeUInt8(1);
          writer.writeVarIntNum(t.pathIndex);
        } else {
          writer.writeUInt8(0);
        }
      }
      return writer.toArray();
    }
    /**
     * Serializes this transaction, together with its inputs and the respective merkle proofs, into the BEEF (BRC-62) format. This enables efficient verification of its compliance with the rules of SPV.
     *
     * @param allowPartial If true, error will not be thrown if there are any missing sourceTransactions.
     *
     * @returns {number[]} The serialized BEEF structure
     * @throws Error if there are any missing sourceTransactions unless `allowPartial` is true.
     */
    toBEEF(allowPartial) {
      const writer = new Writer();
      this.writeSerializedBEEF(writer, allowPartial);
      return writer.toArray();
    }
    /**
     * Serializes this transaction, together with its inputs and the respective merkle proofs, into the BEEF (BRC-62) format. This enables efficient verification of its compliance with the rules of SPV.
     *
     * @param allowPartial If true, error will not be thrown if there are any missing sourceTransactions.
     *
     * @returns {number[]} The serialized BEEF structure
     * @throws Error if there are any missing sourceTransactions unless `allowPartial` is true.
     */
    toBEEFUint8Array(allowPartial) {
      const writer = new WriterUint8Array();
      this.writeSerializedBEEF(writer, allowPartial);
      return writer.toArray();
    }
    /**
     * Serializes this transaction and its inputs into the Atomic BEEF (BRC-95) format.
     * The Atomic BEEF format starts with a 4-byte prefix `0x01010101`, followed by the TXID of the subject transaction,
     * and then the BEEF data containing only the subject transaction and its dependencies.
     * This format ensures that the BEEF structure is atomic and contains no unrelated transactions.
     *
     * @param allowPartial If true, error will not be thrown if there are any missing sourceTransactions.
     *
     * @returns {number[]} - The serialized Atomic BEEF structure.
     * @throws Error if there are any missing sourceTransactions unless `allowPartial` is true.
     */
    toAtomicBEEF(allowPartial) {
      const prefix = [1, 1, 1, 1];
      const txHash = this.hash();
      const beefData = this.toBEEF(allowPartial);
      return prefix.concat(txHash, beefData);
    }
    /**
     * Serializes this transaction and its inputs into the Atomic BEEF (BRC-95) format.
     * The Atomic BEEF format starts with a 4-byte prefix `0x01010101`, followed by the TXID of the subject transaction,
     * and then the BEEF data containing only the subject transaction and its dependencies.
     * This format ensures that the BEEF structure is atomic and contains no unrelated transactions.
     *
     * @param allowPartial If true, error will not be thrown if there are any missing sourceTransactions.
     *
     * @returns {number[]} - The serialized Atomic BEEF structure.
     * @throws Error if there are any missing sourceTransactions unless `allowPartial` is true.
     */
    toAtomicBEEFUint8Array(allowPartial) {
      const writer = new WriterUint8Array();
      const prefix = [1, 1, 1, 1];
      writer.write(prefix);
      const txHash = this.hash();
      writer.write(txHash);
      this.writeSerializedBEEF(writer, allowPartial);
      return writer.toUint8Array();
    }
    /**
     * Completes the transaction using a wallet interface, which will handle
     * signing and transaction finalization. This method converts the current
     * transaction into a format that can be processed by the wallet, and then
     * updates this transaction object with the result from the wallet.
     *
     * @param {WalletInterface} wallet - The BRC-100 compliant wallet to use for completing the transaction
     * @param {string} [actionDescription] - Optional description for the action
     * @param {string} [originator] - Optional originator domain name
     * @param {CreateActionOptions} [options] - Optional settings for transaction creation (e.g., acceptDelayedBroadcast, trustSelf, noSend, etc.)
     * @returns {Promise<void>}
     */
    async completeWithWallet(wallet, actionDescription, originator, options) {
      const inputCount = this.inputs.length;
      const outputCount = this.outputs.length;
      const description = actionDescription ?? `Transaction with ${inputCount} input(s) and ${outputCount} output(s)`;
      const actionArgs = {
        description,
        inputs: [],
        outputs: [],
        lockTime: this.lockTime,
        version: this.version
      };
      const hasTemplates = this.inputs.some((input) => input.unlockingScriptTemplate != null);
      const beefData = new Beef();
      for (let i = 0; i < this.inputs.length; i++) {
        const input = this.inputs[i];
        if (input.sourceTransaction == null) {
          throw new Error("All inputs must have a sourceTransaction when using completeWithWallet");
        }
        const sourceBEEF = input.sourceTransaction.toBEEF();
        beefData.mergeBeef(sourceBEEF);
        const sourceTXID = input.sourceTransaction.id("hex");
        const inputArg = {
          outpoint: `${sourceTXID}.${input.sourceOutputIndex}`,
          inputDescription: "Input from source transaction",
          sequenceNumber: input.sequence
        };
        if (hasTemplates) {
          if (input.unlockingScriptTemplate != null) {
            const estimatedLength = await input.unlockingScriptTemplate.estimateLength(this, i);
            inputArg.unlockingScriptLength = estimatedLength;
          } else if (input.unlockingScript != null) {
            inputArg.unlockingScript = input.unlockingScript.toHex();
          } else {
            throw new Error(`Input ${i} must have either an unlockingScript or unlockingScriptTemplate`);
          }
        } else {
          if (input.unlockingScript == null) {
            throw new Error("All inputs must have an unlockingScript when using completeWithWallet");
          }
          inputArg.unlockingScript = input.unlockingScript.toHex();
        }
        actionArgs.inputs.push(inputArg);
      }
      if (this.inputs.length > 0) {
        actionArgs.inputBEEF = beefData.toBinary();
      }
      for (const output of this.outputs) {
        actionArgs.outputs.push({
          satoshis: output.satoshis,
          lockingScript: output.lockingScript.toHex(),
          outputDescription: "Output from source transaction"
        });
      }
      if (this.metadata?.labels != null && Array.isArray(this.metadata.labels)) {
        actionArgs.labels = this.metadata.labels;
      }
      let atomicBEEF;
      if (hasTemplates) {
        actionArgs.options = {
          ...options,
          signAndProcess: false
        };
        const { signableTransaction } = await wallet.createAction(actionArgs, originator);
        if (signableTransaction == null) {
          throw new Error("Wallet createAction did not return signableTransaction");
        }
        const partialTx = _Transaction.fromBEEF(signableTransaction.tx);
        const spends = {};
        for (let i = 0; i < this.inputs.length; i++) {
          const input = this.inputs[i];
          if (input.unlockingScriptTemplate != null) {
            const unlockingScript = await input.unlockingScriptTemplate.sign(partialTx, i);
            spends[i] = {
              unlockingScript: unlockingScript.toHex()
            };
          } else if (input.unlockingScript != null) {
            spends[i] = {
              unlockingScript: input.unlockingScript.toHex()
            };
          }
        }
        const signActionOptions = options == null ? void 0 : {
          acceptDelayedBroadcast: options.acceptDelayedBroadcast,
          returnTXIDOnly: options.returnTXIDOnly,
          noSend: options.noSend,
          sendWith: options.sendWith
        };
        const signResult = await wallet.signAction({
          reference: signableTransaction.reference,
          spends,
          options: signActionOptions
        }, originator);
        if (signResult.tx == null) {
          throw new Error("Wallet signAction did not return transaction data");
        }
        atomicBEEF = signResult.tx;
      } else {
        if (options != null) {
          actionArgs.options = options;
        }
        const { tx } = await wallet.createAction(actionArgs, originator);
        if (tx == null) {
          throw new Error("Wallet createAction did not return transaction data");
        }
        atomicBEEF = tx;
      }
      const newTransaction = _Transaction.fromAtomicBEEF(atomicBEEF);
      this.version = newTransaction.version;
      this.inputs = newTransaction.inputs;
      this.outputs = newTransaction.outputs;
      this.lockTime = newTransaction.lockTime;
      this.merklePath = newTransaction.merklePath;
      this.cachedHash = newTransaction.cachedHash;
      this.metadata = {
        ...this.metadata,
        ...newTransaction.metadata
      };
    }
    /**
     * Returns the formatted preimage of a transaction for the requested input index, signature scope (default SIGHASH_FORKID | SIGHASH_ALL), and optional subscript.
     * @param inputIndex - The index of the input to generate the preimage for
     * @param signatureScope - The signature scope to use for the preimage
     * @param subscript - The subscript to use for the preimage (optional)
     * @returns The formatted preimage
     */
    preimage(inputIndex, signatureScope, subscript) {
      inputIndex ?? (inputIndex = 0);
      signatureScope ?? (signatureScope = TransactionSignature.SIGHASH_FORKID | TransactionSignature.SIGHASH_ALL);
      if (inputIndex < 0 || inputIndex >= this.inputs.length) {
        throw new Error("Invalid input index");
      }
      const flags = signatureScope & 240;
      if (flags !== 224 && flags !== 192 && flags !== 64) {
        throw new Error("FORKID must be set");
      }
      const coverage = signatureScope & 15;
      if (coverage < 1 || coverage > 3) {
        throw new Error("Invalid signature coverage, must be all, none or single");
      }
      const input = this.inputs[inputIndex];
      if (input.sourceTransaction == null) {
        throw new Error("Source transaction is required");
      }
      const output = input.sourceTransaction.outputs[input.sourceOutputIndex];
      if (output == null) {
        throw new Error(`Source transaction's output at index ${input.sourceOutputIndex} is required`);
      }
      const otherInputs = this.inputs.filter((_, index) => index !== inputIndex);
      return TransactionSignature.format({
        sourceTXID: input.sourceTXID ?? input.sourceTransaction.id("hex"),
        sourceOutputIndex: input.sourceOutputIndex,
        sourceSatoshis: output.satoshis,
        transactionVersion: this.version,
        otherInputs,
        inputIndex,
        outputs: this.outputs,
        inputSequence: input.sequence ?? 4294967295,
        subscript: subscript ?? output.lockingScript,
        lockTime: this.lockTime,
        scope: signatureScope
      });
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/compat/ECIES.js
  function AES2(key2) {
    if (this._tables[0][0][0] === 0)
      this._precompute();
    let tmp;
    const sbox = this._tables[0][4];
    const decTable = this._tables[1];
    const keyLen = key2.length;
    let rcon = 1;
    if (keyLen !== 4 && keyLen !== 6 && keyLen !== 8) {
      throw new Error("invalid aes key size");
    }
    const encKey = key2.slice(0);
    const decKey = [];
    this._key = [encKey, decKey];
    let i;
    for (i = keyLen; i < 4 * keyLen + 28; i++) {
      tmp = encKey[i - 1];
      if (i % keyLen === 0 || keyLen === 8 && i % keyLen === 4) {
        tmp = sbox[tmp >>> 24] << 24 ^ sbox[tmp >> 16 & 255] << 16 ^ sbox[tmp >> 8 & 255] << 8 ^ sbox[tmp & 255];
        if (i % keyLen === 0) {
          tmp = tmp << 8 ^ tmp >>> 24 ^ rcon << 24;
          rcon = rcon << 1 ^ (rcon >> 7) * 283;
        }
      }
      encKey[i] = encKey[i - keyLen] ^ tmp;
    }
    for (let j = 0; i > 0; j++, i--) {
      tmp = encKey[(j & 3) === 0 ? i - 4 : i];
      if (i <= 4 || j < 4) {
        decKey[j] = tmp;
      } else {
        decKey[j] = decTable[0][sbox[tmp >>> 24]] ^ decTable[1][sbox[tmp >> 16 & 255]] ^ decTable[2][sbox[tmp >> 8 & 255]] ^ decTable[3][sbox[tmp & 255]];
      }
    }
  }
  AES2.prototype = {
    /**
     * Encrypt an array of 4 big-endian words.
     * @param {Array} data The plaintext.
     * @return {Array} The ciphertext.
     */
    encrypt: function(data) {
      return this._crypt(data, 0);
    },
    /**
     * Decrypt an array of 4 big-endian words.
     * @param {Array} data The ciphertext.
     * @return {Array} The plaintext.
     */
    decrypt: function(data) {
      return this._crypt(data, 1);
    },
    /**
     * The expanded S-box and inverse S-box tables.  These will be computed
     * on the client so that we don't have to send them down the wire.
     *
     * There are two tables, _tables[0] is for encryption and
     * _tables[1] is for decryption.
     *
     * The first 4 sub-tables are the expanded S-box with MixColumns.  The
     * last (_tables[01][4]) is the S-box itself.
     *
     * @private
     */
    _tables: [
      [
        new Uint32Array(256),
        new Uint32Array(256),
        new Uint32Array(256),
        new Uint32Array(256),
        new Uint32Array(256)
      ],
      [
        new Uint32Array(256),
        new Uint32Array(256),
        new Uint32Array(256),
        new Uint32Array(256),
        new Uint32Array(256)
      ]
    ],
    // Expand the S-box tables.
    _precompute: function() {
      const encTable = this._tables[0];
      const decTable = this._tables[1];
      const sbox = encTable[4];
      const sboxInv = decTable[4];
      let i;
      let x;
      let xInv;
      const d = new Uint8Array(256);
      const th = new Uint8Array(256);
      let x2;
      let x4;
      let x8;
      let s2;
      let tEnc;
      let tDec;
      for (i = 0; i < 256; i++) {
        d[i] = i << 1 ^ (i >> 7) * 283;
        th[d[i] ^ i] = i;
      }
      for (x = xInv = 0; sbox[x] === 0; x ^= x2 === 0 ? 1 : x2, xInv = th[xInv] === 0 ? 1 : th[xInv]) {
        s2 = xInv ^ xInv << 1 ^ xInv << 2 ^ xInv << 3 ^ xInv << 4;
        s2 = s2 >> 8 ^ s2 & 255 ^ 99;
        sbox[x] = s2;
        sboxInv[s2] = x;
        x2 = d[x];
        x4 = d[x2];
        x8 = d[x4];
        tDec = x8 * 16843009 ^ x4 * 65537 ^ x2 * 257 ^ x * 16843008;
        tEnc = d[s2] * 257 ^ s2 * 16843008;
        for (i = 0; i < 4; i++) {
          encTable[i][x] = tEnc = tEnc << 24 ^ tEnc >>> 8;
          decTable[i][s2] = tDec = tDec << 24 ^ tDec >>> 8;
        }
      }
    },
    /**
     * Encryption and decryption core.
     * @param {Array} input Four words to be encrypted or decrypted.
     * @param dir The direction, 0 for encrypt and 1 for decrypt.
     * @return {Array} The four encrypted or decrypted words.
     * @private
     */
    _crypt: function(input, dir) {
      if (input.length !== 4) {
        throw new Error("invalid aes block size");
      }
      const key2 = this._key[dir];
      let a = input[0] ^ key2[0];
      let b = input[dir === 1 ? 3 : 1] ^ key2[1];
      let c = input[2] ^ key2[2];
      let d = input[dir === 1 ? 1 : 3] ^ key2[3];
      let a2;
      let b2;
      let c2;
      const nInnerRounds = key2.length / 4 - 2;
      let i;
      let kIndex = 4;
      const out = new Uint32Array(4);
      const table = this._tables[dir];
      const t0 = table[0];
      const t1 = table[1];
      const t2 = table[2];
      const t3 = table[3];
      const sbox = table[4];
      for (i = 0; i < nInnerRounds; i++) {
        a2 = t0[a >>> 24] ^ t1[b >> 16 & 255] ^ t2[c >> 8 & 255] ^ t3[d & 255] ^ key2[kIndex];
        b2 = t0[b >>> 24] ^ t1[c >> 16 & 255] ^ t2[d >> 8 & 255] ^ t3[a & 255] ^ key2[kIndex + 1];
        c2 = t0[c >>> 24] ^ t1[d >> 16 & 255] ^ t2[a >> 8 & 255] ^ t3[b & 255] ^ key2[kIndex + 2];
        d = t0[d >>> 24] ^ t1[a >> 16 & 255] ^ t2[b >> 8 & 255] ^ t3[c & 255] ^ key2[kIndex + 3];
        kIndex += 4;
        a = a2;
        b = b2;
        c = c2;
      }
      for (i = 0; i < 4; i++) {
        out[dir === 1 ? 3 & -i : i] = sbox[a >>> 24] << 24 ^ sbox[b >> 16 & 255] << 16 ^ sbox[c >> 8 & 255] << 8 ^ sbox[d & 255] ^ key2[kIndex++];
        a2 = a;
        a = b;
        b = c;
        c = d;
        d = a2;
      }
      return out;
    }
  };
  var AESWrapper = class _AESWrapper {
    static encrypt(messageBuf, keyBuf) {
      const key2 = _AESWrapper.buf2Words(keyBuf);
      const message = _AESWrapper.buf2Words(messageBuf);
      const a = new AES2(key2);
      const enc = a.encrypt(message);
      const encBuf = _AESWrapper.words2Buf(enc);
      return encBuf;
    }
    static decrypt(encBuf, keyBuf) {
      const enc = _AESWrapper.buf2Words(encBuf);
      const key2 = _AESWrapper.buf2Words(keyBuf);
      const a = new AES2(key2);
      const message = a.decrypt(enc);
      const messageBuf = _AESWrapper.words2Buf(message);
      return messageBuf;
    }
    static buf2Words(buf) {
      if (buf.length % 4 !== 0) {
        throw new Error("buf length must be a multiple of 4");
      }
      const words = [];
      for (let i = 0; i < buf.length / 4; i++) {
        const val2 = buf[i * 4] * 16777216 + // Shift the first byte by 24 bits
        (buf[i * 4 + 1] << 16 | // Shift the second byte by 16 bits
        buf[i * 4 + 2] << 8 | // Shift the third byte by 8 bits
        buf[i * 4 + 3]);
        words.push(val2);
      }
      return words;
    }
    static words2Buf(words) {
      const buf = new Array(words.length * 4);
      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        buf[i * 4] = word >>> 24 & 255;
        buf[i * 4 + 1] = word >>> 16 & 255;
        buf[i * 4 + 2] = word >>> 8 & 255;
        buf[i * 4 + 3] = word & 255;
      }
      return buf;
    }
  };
  var CBC = class _CBC {
    static buf2BlocksBuf(buf, blockSize) {
      const bytesize = blockSize / 8;
      const blockBufs = [];
      for (let i = 0; i <= buf.length / bytesize; i++) {
        let blockBuf = buf.slice(i * bytesize, i * bytesize + bytesize);
        if (blockBuf.length < blockSize) {
          blockBuf = _CBC.pkcs7Pad(blockBuf, blockSize);
        }
        blockBufs.push(blockBuf);
      }
      return blockBufs;
    }
    static blockBufs2Buf(blockBufs) {
      let last = blockBufs.at(-1);
      last = _CBC.pkcs7Unpad(last);
      blockBufs[blockBufs.length - 1] = last;
      const buf = blockBufs.flat();
      return buf;
    }
    static encrypt(messageBuf, ivBuf, blockCipher, cipherKeyBuf) {
      const blockSize = ivBuf.length * 8;
      const blockBufs = _CBC.buf2BlocksBuf(messageBuf, blockSize);
      const encBufs = _CBC.encryptBlocks(blockBufs, ivBuf, blockCipher, cipherKeyBuf);
      const encBuf = encBufs.flat();
      return encBuf;
    }
    static decrypt(encBuf, ivBuf, blockCipher, cipherKeyBuf) {
      const bytesize = ivBuf.length;
      const encBufs = [];
      for (let i = 0; i < encBuf.length / bytesize; i++) {
        encBufs.push(encBuf.slice(i * bytesize, i * bytesize + bytesize));
      }
      const blockBufs = _CBC.decryptBlocks(encBufs, ivBuf, blockCipher, cipherKeyBuf);
      const buf = _CBC.blockBufs2Buf(blockBufs);
      return buf;
    }
    static encryptBlock(blockBuf, ivBuf, blockCipher, cipherKeyBuf) {
      const xorbuf = _CBC.xorBufs(blockBuf, ivBuf);
      const encBuf = blockCipher.encrypt(xorbuf, cipherKeyBuf);
      return encBuf;
    }
    static decryptBlock(encBuf, ivBuf, blockCipher, cipherKeyBuf) {
      const xorbuf = blockCipher.decrypt(encBuf, cipherKeyBuf);
      const blockBuf = _CBC.xorBufs(xorbuf, ivBuf);
      return blockBuf;
    }
    static encryptBlocks(blockBufs, ivBuf, blockCipher, cipherKeyBuf) {
      const encBufs = [];
      for (const blockBuf of blockBufs) {
        const encBuf = _CBC.encryptBlock(blockBuf, ivBuf, blockCipher, cipherKeyBuf);
        encBufs.push(encBuf);
        ivBuf = encBuf;
      }
      return encBufs;
    }
    static decryptBlocks(encBufs, ivBuf, blockCipher, cipherKeyBuf) {
      const blockBufs = [];
      for (const encBuf of encBufs) {
        const blockBuf = _CBC.decryptBlock(encBuf, ivBuf, blockCipher, cipherKeyBuf);
        blockBufs.push(blockBuf);
        ivBuf = encBuf;
      }
      return blockBufs;
    }
    static pkcs7Pad(buf, blockSize) {
      const bytesize = blockSize / 8;
      const padbytesize = bytesize - buf.length;
      const pad = new Array(padbytesize);
      pad.fill(padbytesize);
      const paddedbuf = [...buf, ...pad];
      return paddedbuf;
    }
    static pkcs7Unpad(paddedbuf) {
      const padlength = paddedbuf.at(-1);
      const padbuf = paddedbuf.slice(paddedbuf.length - padlength, paddedbuf.length);
      const padbuf2 = new Array(padlength);
      padbuf2.fill(padlength);
      if (toHex(padbuf) !== toHex(padbuf2)) {
        throw new Error("invalid padding");
      }
      return paddedbuf.slice(0, paddedbuf.length - padlength);
    }
    static xorBufs(buf1, buf2) {
      if (buf1.length !== buf2.length) {
        throw new Error("bufs must have the same length");
      }
      const buf = new Array(buf1.length);
      for (let i = 0; i < buf1.length; i++) {
        buf[i] = buf1[i] ^ buf2[i];
      }
      return buf;
    }
  };
  var AESCBC = class {
    static encrypt(messageBuf, cipherKeyBuf, ivBuf, concatIvBuf = true) {
      ivBuf = ivBuf ?? Random_default(128 / 8);
      const ctBuf = CBC.encrypt(messageBuf, ivBuf, AESWrapper, cipherKeyBuf);
      if (concatIvBuf) {
        return [...ivBuf, ...ctBuf];
      } else {
        return [...ctBuf];
      }
    }
    static decrypt(encBuf, cipherKeyBuf, ivBuf) {
      if (ivBuf == null) {
        ivBuf = encBuf.slice(0, 128 / 8);
        const ctBuf = encBuf.slice(128 / 8);
        return CBC.decrypt(ctBuf, ivBuf, AESWrapper, cipherKeyBuf);
      } else {
        const ctBuf = encBuf;
        return CBC.decrypt(ctBuf, ivBuf, AESWrapper, cipherKeyBuf);
      }
    }
  };
  var ECIES = class _ECIES {
    /**
     * Generates the initialization vector (iv), encryption key (kE), and MAC key (kM)
     * using the sender's private key and receiver's public key.
     *
     * @param {PrivateKey} privKey - The sender's private key.
     * @param {PublicKey} pubKey - The receiver's public key.
     * @returns {Object} An object containing the iv, kE, and kM as number arrays.
     */
    static ivkEkM(privKey, pubKey) {
      const r2 = privKey;
      const KB = pubKey;
      const P2 = KB.mul(r2);
      const S = new PublicKey(P2.x, P2.y);
      const Sbuf = S.encode(true);
      const hash = sha512(Sbuf);
      return {
        iv: hash.slice(0, 16),
        kE: hash.slice(16, 32),
        kM: hash.slice(32, 64)
      };
    }
    /**
     * Encrypts a given message using the Electrum ECIES method.
     *
     * @param {number[]} messageBuf - The message to be encrypted, in number array format.
     * @param {PublicKey} toPublicKey - The public key of the recipient.
     * @param {PrivateKey} [fromPrivateKey] - The private key of the sender. If not provided, a random private key is used.
     * @param {boolean} [noKey=false] - If true, does not include the sender's public key in the encrypted message.
     * @returns {number[]} The encrypted message as a number array.
     */
    static electrumEncrypt(messageBuf, toPublicKey, fromPrivateKey, noKey = false) {
      let Rbuf = null;
      fromPrivateKey ?? (fromPrivateKey = PrivateKey.fromRandom());
      if (!noKey) {
        Rbuf = fromPrivateKey.toPublicKey().encode(true);
      }
      const { iv, kE, kM } = _ECIES.ivkEkM(fromPrivateKey, toPublicKey);
      const ciphertext = AESCBC.encrypt(messageBuf, kE, iv, false);
      const BIE1 = toArray2("BIE1", "utf8");
      let encBuf;
      if (Rbuf !== void 0 && Rbuf !== null && Rbuf.length > 0) {
        encBuf = [...BIE1, ...Rbuf, ...ciphertext];
      } else {
        encBuf = [...BIE1, ...ciphertext];
      }
      const hmac2 = sha256hmac(kM, encBuf);
      return [...encBuf, ...hmac2];
    }
    /**
     * Decrypts a message encrypted using the Electrum ECIES method.
     *
     * @param {number[]} encBuf - The encrypted message buffer.
     * @param {PrivateKey} toPrivateKey - The private key of the recipient.
     * @param {PublicKey} [fromPublicKey=null] - The public key of the sender. If not provided, it is extracted from the message.
     * @returns {number[]} The decrypted message as a number array.
     */
    static electrumDecrypt(encBuf, toPrivateKey, fromPublicKey) {
      const tagLength = 32;
      const magic = encBuf.slice(0, 4);
      if (encode(magic, "utf8") !== "BIE1") {
        throw new Error("Invalid Magic");
      }
      let offset = 4;
      let Rbuf = null;
      if (encBuf.length - offset - tagLength >= 33) {
        const firstByte = encBuf[offset];
        if (firstByte === 2 || firstByte === 3) {
          Rbuf = encBuf.slice(offset, offset + 33);
          offset += 33;
        } else if (firstByte === 4) {
          Rbuf = encBuf.slice(offset, offset + 65);
          offset += 65;
        }
      }
      if (Rbuf === null) {
        if (fromPublicKey == null) {
          throw new Error("Sender public key is required");
        }
      } else {
        fromPublicKey ?? (fromPublicKey = PublicKey.fromString(toHex(Rbuf)));
      }
      const { iv, kE, kM } = _ECIES.ivkEkM(toPrivateKey, fromPublicKey);
      const ciphertext = encBuf.slice(offset, encBuf.length - tagLength);
      const hmac2 = encBuf.slice(encBuf.length - tagLength, encBuf.length);
      const hmac22 = sha256hmac(kM, encBuf.slice(0, encBuf.length - tagLength));
      if (toHex(hmac2) !== toHex(hmac22)) {
        throw new Error("Invalid checksum");
      }
      return AESCBC.decrypt(ciphertext, kE, iv);
    }
    /**
     * Encrypts a given message using the Bitcore variant of ECIES.
     *
     * @param {number[]} messageBuf - The message to be encrypted, in number array format.
     * @param {PublicKey} toPublicKey - The public key of the recipient.
     * @param {PrivateKey} [fromPrivateKey] - The private key of the sender. If not provided, a random private key is used.
     * @param {number[]} [ivBuf] - The initialization vector for encryption. If not provided, a random IV is used.
     * @returns {number[]} The encrypted message as a number array.
     */
    static bitcoreEncrypt(messageBuf, toPublicKey, fromPrivateKey, ivBuf) {
      fromPrivateKey ?? (fromPrivateKey = PrivateKey.fromRandom());
      ivBuf ?? (ivBuf = Random_default(16));
      const r2 = fromPrivateKey;
      const RPublicKey = fromPrivateKey.toPublicKey();
      const RBuf = RPublicKey.encode(true);
      const KB = toPublicKey;
      const P2 = KB.mul(r2);
      const S = P2.getX();
      const Sbuf = S.toArray("be", 32);
      const kEkM = sha512(Sbuf);
      const kE = kEkM.slice(0, 32);
      const kM = kEkM.slice(32, 64);
      const c = AESCBC.encrypt(messageBuf, kE, ivBuf);
      const d = sha256hmac(kM, [...c]);
      const encBuf = [...RBuf, ...c, ...d];
      return encBuf;
    }
    /**
     * Decrypts a message encrypted using the Bitcore variant of ECIES.
     *
     * @param {number[]} encBuf - The encrypted message buffer.
     * @param {PrivateKey} toPrivateKey - The private key of the recipient.
     * @returns {number[]} The decrypted message as a number array.
     */
    static bitcoreDecrypt(encBuf, toPrivateKey) {
      const kB = toPrivateKey;
      const fromPublicKey = PublicKey.fromString(toHex(encBuf.slice(0, 33)));
      const R2 = fromPublicKey;
      const P2 = R2.mul(kB);
      if (P2.eq(new Point(0, 0))) {
        throw new Error("P equals 0");
      }
      const S = P2.getX();
      const Sbuf = S.toArray("be", 32);
      const kEkM = sha512(Sbuf);
      const kE = kEkM.slice(0, 32);
      const kM = kEkM.slice(32, 64);
      const c = encBuf.slice(33, -32);
      const d = encBuf.slice(-32);
      const d2 = sha256hmac(kM, c);
      if (toHex(d) !== toHex(d2)) {
        throw new Error("Invalid checksum");
      }
      const messageBuf = AESCBC.decrypt(c, kE);
      return [...messageBuf];
    }
  };

  // node_modules/@bsv/sdk/dist/esm/src/wallet/Wallet.interfaces.js
  var SecurityLevels;
  (function(SecurityLevels2) {
    SecurityLevels2[SecurityLevels2["Silent"] = 0] = "Silent";
    SecurityLevels2[SecurityLevels2["App"] = 1] = "App";
    SecurityLevels2[SecurityLevels2["Counterparty"] = 2] = "Counterparty";
  })(SecurityLevels || (SecurityLevels = {}));

  // node_modules/@bsv/sdk/dist/esm/src/wallet/WalletError.js
  var walletErrors;
  (function(walletErrors2) {
    walletErrors2[walletErrors2["unknownError"] = 1] = "unknownError";
    walletErrors2[walletErrors2["unsupportedAction"] = 2] = "unsupportedAction";
    walletErrors2[walletErrors2["invalidHmac"] = 3] = "invalidHmac";
    walletErrors2[walletErrors2["invalidSignature"] = 4] = "invalidSignature";
    walletErrors2[walletErrors2["reviewActions"] = 5] = "reviewActions";
    walletErrors2[walletErrors2["invalidParameter"] = 6] = "invalidParameter";
    walletErrors2[walletErrors2["insufficientFunds"] = 7] = "insufficientFunds";
  })(walletErrors || (walletErrors = {}));

  // node_modules/@bsv/sdk/dist/esm/src/wallet/substrates/WalletWireCalls.js
  var calls;
  (function(calls2) {
    calls2[calls2["createAction"] = 1] = "createAction";
    calls2[calls2["signAction"] = 2] = "signAction";
    calls2[calls2["abortAction"] = 3] = "abortAction";
    calls2[calls2["listActions"] = 4] = "listActions";
    calls2[calls2["internalizeAction"] = 5] = "internalizeAction";
    calls2[calls2["listOutputs"] = 6] = "listOutputs";
    calls2[calls2["relinquishOutput"] = 7] = "relinquishOutput";
    calls2[calls2["getPublicKey"] = 8] = "getPublicKey";
    calls2[calls2["revealCounterpartyKeyLinkage"] = 9] = "revealCounterpartyKeyLinkage";
    calls2[calls2["revealSpecificKeyLinkage"] = 10] = "revealSpecificKeyLinkage";
    calls2[calls2["encrypt"] = 11] = "encrypt";
    calls2[calls2["decrypt"] = 12] = "decrypt";
    calls2[calls2["createHmac"] = 13] = "createHmac";
    calls2[calls2["verifyHmac"] = 14] = "verifyHmac";
    calls2[calls2["createSignature"] = 15] = "createSignature";
    calls2[calls2["verifySignature"] = 16] = "verifySignature";
    calls2[calls2["acquireCertificate"] = 17] = "acquireCertificate";
    calls2[calls2["listCertificates"] = 18] = "listCertificates";
    calls2[calls2["proveCertificate"] = 19] = "proveCertificate";
    calls2[calls2["relinquishCertificate"] = 20] = "relinquishCertificate";
    calls2[calls2["discoverByIdentityKey"] = 21] = "discoverByIdentityKey";
    calls2[calls2["discoverByAttributes"] = 22] = "discoverByAttributes";
    calls2[calls2["isAuthenticated"] = 23] = "isAuthenticated";
    calls2[calls2["waitForAuthentication"] = 24] = "waitForAuthentication";
    calls2[calls2["getHeight"] = 25] = "getHeight";
    calls2[calls2["getHeaderForHeight"] = 26] = "getHeaderForHeight";
    calls2[calls2["getNetwork"] = 27] = "getNetwork";
    calls2[calls2["getVersion"] = 28] = "getVersion";
  })(calls || (calls = {}));

  // node_modules/@bsv/sdk/dist/esm/src/auth/Peer.js
  var BufferCtor5 = typeof globalThis === "undefined" ? void 0 : globalThis.Buffer;

  // node_modules/@bsv/sdk/dist/esm/src/auth/transports/SimplifiedFetchTransport.js
  var defaultFetch = typeof globalThis !== "undefined" && typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : fetch;

  // node_modules/@bsv/sdk/dist/esm/src/overlay-tools/HostReputationTracker.js
  var DEFAULT_LATENCY_MS = 1500;
  var LATENCY_SMOOTHING_FACTOR = 0.25;
  var BASE_BACKOFF_MS = 1e3;
  var MAX_BACKOFF_MS = 6e4;
  var FAILURE_PENALTY_MS = 400;
  var SUCCESS_BONUS_MS = 30;
  var FAILURE_BACKOFF_GRACE = 2;
  var STORAGE_KEY = "bsvsdk_overlay_host_reputation_v1";
  var HostReputationTracker = class {
    constructor(store3) {
      __publicField(this, "stats");
      __publicField(this, "store");
      this.stats = /* @__PURE__ */ new Map();
      this.store = store3 ?? this.getLocalStorageAdapter();
      this.loadFromStorage();
    }
    reset() {
      this.stats.clear();
    }
    recordSuccess(host, latencyMs) {
      const entry = this.getOrCreate(host);
      const now = Date.now();
      const safeLatency = Number.isFinite(latencyMs) && latencyMs >= 0 ? latencyMs : DEFAULT_LATENCY_MS;
      if (entry.avgLatencyMs === null) {
        entry.avgLatencyMs = safeLatency;
      } else {
        entry.avgLatencyMs = (1 - LATENCY_SMOOTHING_FACTOR) * entry.avgLatencyMs + LATENCY_SMOOTHING_FACTOR * safeLatency;
      }
      entry.lastLatencyMs = safeLatency;
      entry.totalSuccesses += 1;
      entry.consecutiveFailures = 0;
      entry.backoffUntil = 0;
      entry.lastUpdatedAt = now;
      entry.lastError = void 0;
      this.saveToStorage();
    }
    recordFailure(host, reason) {
      const entry = this.getOrCreate(host);
      const now = Date.now();
      entry.totalFailures += 1;
      entry.consecutiveFailures += 1;
      let msg;
      if (typeof reason === "string") {
        msg = reason;
      } else if (reason instanceof Error) {
        msg = reason.message;
      } else {
        msg = void 0;
      }
      const immediate = typeof msg === "string" && (msg.includes("ERR_NAME_NOT_RESOLVED") || msg.includes("ENOTFOUND") || msg.includes("getaddrinfo") || msg.includes("Failed to fetch"));
      if (immediate && entry.consecutiveFailures < FAILURE_BACKOFF_GRACE + 1) {
        entry.consecutiveFailures = FAILURE_BACKOFF_GRACE + 1;
      }
      const penaltyLevel = Math.max(entry.consecutiveFailures - FAILURE_BACKOFF_GRACE, 0);
      if (penaltyLevel === 0) {
        entry.backoffUntil = 0;
      } else {
        const backoffDuration = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, penaltyLevel - 1));
        entry.backoffUntil = now + backoffDuration;
      }
      entry.lastUpdatedAt = now;
      if (typeof reason === "string") {
        entry.lastError = reason;
      } else if (reason instanceof Error) {
        entry.lastError = reason.message;
      } else {
        entry.lastError = void 0;
      }
      this.saveToStorage();
    }
    rankHosts(hosts, now = Date.now()) {
      const seen = /* @__PURE__ */ new Map();
      hosts.forEach((host, idx) => {
        if (typeof host !== "string" || host.length === 0)
          return;
        if (!seen.has(host))
          seen.set(host, idx);
      });
      const orderedHosts = Array.from(seen.keys());
      const ranked = orderedHosts.map((host) => {
        const entry = this.getOrCreate(host);
        return {
          ...entry,
          score: this.computeScore(entry, now),
          originalOrder: seen.get(host) ?? 0
        };
      });
      ranked.sort((a, b) => {
        const aInBackoff = a.backoffUntil > now;
        const bInBackoff = b.backoffUntil > now;
        if (aInBackoff !== bInBackoff)
          return aInBackoff ? 1 : -1;
        if (a.score !== b.score)
          return a.score - b.score;
        if (a.totalSuccesses !== b.totalSuccesses)
          return b.totalSuccesses - a.totalSuccesses;
        return a.originalOrder - b.originalOrder;
      });
      return ranked.map(({ originalOrder, ...rest }) => rest);
    }
    snapshot(host) {
      const entry = this.stats.get(host);
      return entry == null ? void 0 : { ...entry };
    }
    getStorage() {
      try {
        const g = typeof globalThis === "object" ? globalThis : void 0;
        if (g?.localStorage == null)
          return void 0;
        return g.localStorage;
      } catch {
        return void 0;
      }
    }
    getLocalStorageAdapter() {
      const s2 = this.getStorage();
      if (s2 == null)
        return void 0;
      return {
        get: (key2) => {
          try {
            return s2.getItem(key2);
          } catch {
            return null;
          }
        },
        set: (key2, value) => {
          try {
            s2.setItem(key2, value);
          } catch {
          }
        }
      };
    }
    loadFromStorage() {
      const s2 = this.store;
      if (s2 == null)
        return;
      try {
        const raw = s2.get(STORAGE_KEY);
        if (typeof raw !== "string" || raw.length === 0)
          return;
        const data = JSON.parse(raw);
        if (typeof data !== "object" || data === null)
          return;
        this.stats.clear();
        for (const k of Object.keys(data)) {
          const v = data[k];
          if (v != null && typeof v === "object") {
            const entry = {
              host: String(v.host ?? k),
              totalSuccesses: Number(v.totalSuccesses ?? 0),
              totalFailures: Number(v.totalFailures ?? 0),
              consecutiveFailures: Number(v.consecutiveFailures ?? 0),
              avgLatencyMs: v.avgLatencyMs == null ? null : Number(v.avgLatencyMs),
              lastLatencyMs: v.lastLatencyMs == null ? null : Number(v.lastLatencyMs),
              backoffUntil: Number(v.backoffUntil ?? 0),
              lastUpdatedAt: Number(v.lastUpdatedAt ?? 0),
              lastError: typeof v.lastError === "string" ? v.lastError : void 0
            };
            this.stats.set(entry.host, entry);
          }
        }
      } catch {
      }
    }
    saveToStorage() {
      const s2 = this.store;
      if (s2 == null)
        return;
      try {
        const obj = {};
        for (const [host, entry] of this.stats.entries()) {
          obj[host] = entry;
        }
        s2.set(STORAGE_KEY, JSON.stringify(obj));
      } catch {
      }
    }
    computeScore(entry, now) {
      const latency = entry.avgLatencyMs ?? DEFAULT_LATENCY_MS;
      const failurePenalty = entry.consecutiveFailures * FAILURE_PENALTY_MS;
      const successBonus = Math.min(entry.totalSuccesses * SUCCESS_BONUS_MS, latency / 2);
      const backoffPenalty = entry.backoffUntil > now ? entry.backoffUntil - now : 0;
      return latency + failurePenalty + backoffPenalty - successBonus;
    }
    getOrCreate(host) {
      let entry = this.stats.get(host);
      if (entry == null) {
        entry = {
          host,
          totalSuccesses: 0,
          totalFailures: 0,
          consecutiveFailures: 0,
          avgLatencyMs: null,
          lastLatencyMs: null,
          backoffUntil: 0,
          lastUpdatedAt: 0
        };
        this.stats.set(host, entry);
      }
      return entry;
    }
  };
  var globalTracker = new HostReputationTracker();

  // node_modules/@bsv/sdk/dist/esm/src/overlay-tools/LookupResolver.js
  var defaultFetch2 = typeof globalThis !== "undefined" && typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : fetch;

  // src/walletProvider.ts
  var WOC_BASE = typeof location !== "undefined" && location.hostname === "localhost" ? "/woc/v1/bsv/main" : "https://api.whatsonchain.com/v1/bsv/main";
  var MIN_REQUEST_DELAY = 350;
  var fetchQueue = Promise.resolve();
  function queuedFetch(url, init2) {
    return new Promise((resolve, reject) => {
      fetchQueue = fetchQueue.then(async () => {
        try {
          const resp = await fetch(url, init2);
          resolve(resp);
        } catch (err) {
          reject(err);
        }
        await new Promise((r2) => setTimeout(r2, MIN_REQUEST_DELAY));
      });
    });
  }
  async function fetchWithRetry(url, init2, maxRetries = 3) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const resp = await queuedFetch(url, init2);
      if (resp.status !== 429 || attempt === maxRetries) return resp;
      await new Promise((r2) => setTimeout(r2, 500 * (attempt + 1)));
    }
    return queuedFetch(url, init2);
  }
  var WalletProvider = class {
    // key: "txId:outputIndex"
    constructor(address2) {
      this.txCache = /* @__PURE__ */ new Map();
      /**
       * v05.22: Local pending UTXO tracking for consecutive transfers.
       *
       * When we broadcast a TX, the change output won't appear in WoC's UTXO list
       * until the TX is confirmed. This prevents consecutive fragment transfers
       * because the second transfer can't find funding UTXOs.
       *
       * Solution: Track pending UTXOs locally and combine with confirmed UTXOs.
       */
      this.pendingUtxos = /* @__PURE__ */ new Map();
      // key: "txId:outputIndex"
      this.spentOutpoints = /* @__PURE__ */ new Set();
      this.address = address2;
    }
    getAddress() {
      return this.address;
    }
    // ── Wallet Operations (UTXO model) ─────────────────────────────
    /**
     * Get spendable UTXOs from WoC's mempool-aware `/unspent/all` endpoint.
     *
     * This endpoint returns BOTH confirmed and unconfirmed UTXOs (so funding can be spent
     * before it confirms), and flags outputs already spent by a mempool tx
     * (`isSpentInMempoolTx`) — which we exclude so we never build a `txn-mempool-conflict`
     * double-spend, even across page reloads (WoC is the source of truth for mempool spends).
     *
     * Local `pendingUtxos`/`spentOutpoints` remain as a short-window supplement covering the
     * lag between our own broadcast and WoC reflecting it.
     */
    async getUtxos() {
      const address2 = this.getAddress();
      const mapRows = (data) => {
        const rows = Array.isArray(data?.result) ? data.result : Array.isArray(data) ? data : [];
        return rows.filter((u) => u.isSpentInMempoolTx !== true).map((u) => ({
          txId: u.tx_hash,
          outputIndex: u.tx_pos,
          satoshis: u.value,
          script: ""
        }));
      };
      const allResp = await fetchWithRetry(`${WOC_BASE}/address/${address2}/unspent/all`);
      if (!allResp.ok) throw new Error(`WoC UTXO fetch failed: ${allResp.status}`);
      const confirmedUtxos = mapRows(await allResp.json());
      let unconfirmedUtxos = [];
      try {
        const ucResp = await fetchWithRetry(`${WOC_BASE}/address/${address2}/unconfirmed/unspent`);
        if (ucResp.ok) unconfirmedUtxos = mapRows(await ucResp.json());
      } catch {
      }
      const seen = /* @__PURE__ */ new Set();
      const onchain = [];
      for (const u of [...confirmedUtxos, ...unconfirmedUtxos]) {
        const k = `${u.txId}:${u.outputIndex}`;
        if (seen.has(k)) continue;
        seen.add(k);
        onchain.push(u);
      }
      const isSpent = (u) => this.spentOutpoints.has(`${u.txId}:${u.outputIndex}`);
      for (const u of onchain) this.pendingUtxos.delete(`${u.txId}:${u.outputIndex}`);
      const available = onchain.filter((u) => !isSpent(u));
      const pending = Array.from(this.pendingUtxos.values()).filter((u) => !isSpent(u));
      console.debug(`getUtxos: ${onchain.length} on-chain (mempool-aware), ${this.spentOutpoints.size} spent locally, ${pending.length} pending = ${available.length + pending.length} available`);
      return [...available, ...pending];
    }
    /**
     * Register a pending transaction for local UTXO tracking.
     *
     * Call this after broadcasting a TX to enable consecutive transfers
     * before the TX is confirmed.
     *
     * @param txId - The broadcast transaction ID
     * @param spentInputs - Outpoints consumed by this TX [{txId, outputIndex}]
     * @param changeOutput - Change output created by this TX (if any)
     */
    registerPendingTx(txId, spentInputs, changeOutput) {
      for (const input of spentInputs) {
        const key2 = `${input.txId}:${input.outputIndex}`;
        this.spentOutpoints.add(key2);
        this.pendingUtxos.delete(key2);
      }
      if (changeOutput && changeOutput.satoshis > 0) {
        const key2 = `${txId}:${changeOutput.outputIndex}`;
        this.pendingUtxos.set(key2, {
          txId,
          outputIndex: changeOutput.outputIndex,
          satoshis: changeOutput.satoshis,
          script: ""
        });
        console.debug(`registerPendingTx: Added pending UTXO ${key2.slice(0, 16)}... (${changeOutput.satoshis} sats)`);
      }
      console.debug(`registerPendingTx: TX ${txId.slice(0, 12)}... spent ${spentInputs.length} inputs, pending UTXOs: ${this.pendingUtxos.size}`);
    }
    /**
     * Clear spent outpoints for a confirmed transaction.
     *
     * Call this when a pending TX is confirmed to clean up tracking state.
     * Note: Pending UTXOs are auto-cleaned in getUtxos() when they appear confirmed.
     */
    clearConfirmedSpends(spentInputs) {
      for (const input of spentInputs) {
        const key2 = `${input.txId}:${input.outputIndex}`;
        this.spentOutpoints.delete(key2);
      }
    }
    async getBalance() {
      const utxos = await this.getUtxos();
      return utxos.reduce((sum, u) => sum + u.satoshis, 0);
    }
    // ── Broadcasting ──────────────────────────────────────────────
    async broadcast(rawHex) {
      const resp = await queuedFetch(`${WOC_BASE}/tx/raw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txhex: rawHex })
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Broadcast failed (${resp.status}): ${text}`);
      }
      const txId = await resp.text();
      return txId.replace(/"/g, "");
    }
    // ── Raw Transactions ──────────────────────────────────────────
    async getRawTransaction(txId) {
      const cached = this.txCache.get(txId);
      if (cached) return cached;
      const resp = await fetchWithRetry(`${WOC_BASE}/tx/${txId}/hex`);
      if (!resp.ok) throw new Error(`WoC raw TX fetch failed: ${resp.status}`);
      const hex = await resp.text();
      this.txCache.set(txId, hex);
      return hex;
    }
    async getSourceTransaction(txId) {
      const hex = await this.getRawTransaction(txId);
      return Transaction.fromHex(hex);
    }
    // ── Block Headers (feeds into SPV verification) ───────────────
    async getBlockHeader(height) {
      const hashResp = await fetchWithRetry(`${WOC_BASE}/block/height/${height}`);
      if (!hashResp.ok) throw new Error(`WoC block height fetch failed: ${hashResp.status}`);
      const hashBody = await hashResp.text();
      let blockHash;
      try {
        const parsed = JSON.parse(hashBody);
        blockHash = typeof parsed === "string" ? parsed : parsed.hash;
      } catch {
        blockHash = hashBody.replace(/"/g, "");
      }
      try {
        const parsed = JSON.parse(hashBody);
        if (typeof parsed === "object" && parsed.merkleroot) {
          return {
            height,
            merkleRoot: parsed.merkleroot,
            hash: parsed.hash,
            timestamp: parsed.time,
            prevHash: parsed.previousblockhash
          };
        }
      } catch {
      }
      const headerResp = await fetchWithRetry(`${WOC_BASE}/block/${blockHash}/header`);
      if (!headerResp.ok) throw new Error(`WoC block header fetch failed: ${headerResp.status}`);
      const hdr = await headerResp.json();
      return {
        height,
        merkleRoot: hdr.merkleroot,
        hash: hdr.hash,
        timestamp: hdr.time,
        prevHash: hdr.previousblockhash
      };
    }
    // ── Address History ───────────────────────────────────────────
    async getAddressHistory(address2 = this.getAddress()) {
      const resp = await fetchWithRetry(`${WOC_BASE}/address/${address2}/history`);
      if (!resp.ok) throw new Error(`WoC history fetch failed: ${resp.status}`);
      const data = await resp.json();
      if (!Array.isArray(data)) return [];
      return data.map((entry) => ({
        txId: entry.tx_hash,
        blockHeight: entry.height ?? 0
      }));
    }
    // ── Script-hash UTXOs (find covenant outputs not at our address) ──
    /**
     * Unspent outputs paying a given script hash. Edition covenant outputs are locked to an owner pubkey
     * embedded in a custom script, NOT to a P2PKH address, so they aren't in any address's UTXO set — but
     * their exact script is deterministically derivable (covenant.buildHolderEditionScript), and WoC indexes
     * by script hash. This is how the sales page resolves a holder's current spendable edition.
     *
     * Uses the MEMPOOL-AWARE `/unspent/all` (confirmed + unconfirmed, flags mempool-spent) so a just-acquired
     * edition — and the note/bonus that rode in on its tx — resolves immediately, before confirmation; falls
     * back to the confirmed-only `/unspent` if `/all` isn't available. `scriptHash` is SHA-256(scriptBytes)
     * byte-reversed (Electrum/WoC convention).
     */
    async getUnspentByScriptHash(scriptHash) {
      const mapRows = (data) => {
        const rows = Array.isArray(data?.result) ? data.result : Array.isArray(data) ? data : [];
        return rows.filter((u) => u.isSpentInMempoolTx !== true).map((u) => ({ txId: u.tx_hash, outputIndex: u.tx_pos, satoshis: u.value, script: "", height: u.height }));
      };
      const all = await fetchWithRetry(`${WOC_BASE}/script/${scriptHash}/unspent/all`);
      if (all.ok) return mapRows(await all.json());
      const resp = await fetchWithRetry(`${WOC_BASE}/script/${scriptHash}/unspent`);
      if (!resp.ok) throw new Error(`WoC script-unspent fetch failed: ${resp.status}`);
      return mapRows(await resp.json());
    }
    /**
     * Mempool-aware txids touching an address, via `/unspent/all` (confirmed + unconfirmed outputs).
     * A just-broadcast tx's change output appears here before it confirms, so this surfaces a freshly
     * published seller-note (its change pays the seller's address) that `/history` hasn't indexed yet.
     */
    async getRecentTxIdsForAddress(address2) {
      const out = /* @__PURE__ */ new Set();
      try {
        const r2 = await fetchWithRetry(`${WOC_BASE}/address/${address2}/unspent/all`);
        if (r2.ok) {
          const data = await r2.json();
          const rows = Array.isArray(data?.result) ? data.result : Array.isArray(data) ? data : [];
          for (const u of rows) if (u.tx_hash) out.add(u.tx_hash);
        }
      } catch {
      }
      return [...out];
    }
    // ── Merkle Proofs (feeds into proof chain construction) ───────
    async getMerkleProof(txId) {
      const resp = await fetchWithRetry(`${WOC_BASE}/tx/${txId}/proof/tsc`);
      if (!resp.ok) {
        console.debug(`getMerkleProof: WoC returned ${resp.status} for ${txId.slice(0, 12)}...`);
        return null;
      }
      const raw = await resp.json();
      console.debug("getMerkleProof: raw response:", JSON.stringify(raw).slice(0, 200));
      const data = Array.isArray(raw) ? raw[0] : raw;
      if (!data || !data.target) {
        console.debug("getMerkleProof: no target in proof data:", data);
        return null;
      }
      const nodes = data.nodes ?? [];
      const index = data.index ?? 0;
      const path = [];
      let idx = index;
      for (const node of nodes) {
        if (node === "*") {
          idx = idx >> 1;
          continue;
        }
        const position = idx % 2 === 0 ? "R" : "L";
        path.push({ hash: node, position });
        idx = idx >> 1;
      }
      const blockHash = data.target;
      const headerResp = await fetchWithRetry(`${WOC_BASE}/block/${blockHash}/header`);
      if (!headerResp.ok) return null;
      const header = await headerResp.json();
      return {
        txId,
        blockHeight: header.height,
        merkleRoot: header.merkleroot,
        path
      };
    }
  };

  // src/pharlapStore.ts
  var STORAGE_KEY2 = "p:tokens";
  function outpointKey(t) {
    return `${t.txId}:${t.outputIndex}`;
  }
  function migrateLegacyKeys(t) {
    const legacy = t;
    if (t.publisherPubKeyHashHex === void 0 && legacy.creatorPubKeyHashHex !== void 0) {
      t.publisherPubKeyHashHex = legacy.creatorPubKeyHashHex;
    }
    if (t.publisherFeeSats === void 0 && legacy.creatorFeeSats !== void 0) {
      t.publisherFeeSats = legacy.creatorFeeSats;
    }
    return t;
  }
  var PharLapStore = class {
    constructor(kv) {
      const fallback = globalThis.localStorage;
      if (kv == null && fallback == null) {
        throw new Error("PharLapStore: no KV store available (localStorage missing)");
      }
      this.kv = kv ?? fallback;
    }
    list() {
      const raw = this.kv.getItem(STORAGE_KEY2);
      if (raw == null || raw === "") return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map(migrateLegacyKeys) : [];
      } catch {
        return [];
      }
    }
    write(tokens) {
      this.kv.setItem(STORAGE_KEY2, JSON.stringify(tokens));
    }
    /** Empty the cache (e.g. on wallet switch — holdings are rebuildable from the WIF + chain). */
    clear() {
      this.write([]);
    }
    /** Add a token if not already present (dedup by outpoint). Returns true if added. */
    add(token) {
      const tokens = this.list();
      const k = outpointKey(token);
      if (tokens.some((t) => outpointKey(t) === k)) return false;
      tokens.push({
        txId: token.txId,
        outputIndex: token.outputIndex,
        collectionId: token.collectionId,
        stateData: token.stateData,
        collectionName: token.collectionName,
        status: "active",
        addedAt: token.addedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
        kind: token.kind,
        lockHex: token.lockHex,
        publisherPubKeyHashHex: token.publisherPubKeyHashHex,
        publisherFeeSats: token.publisherFeeSats,
        holderFeeSats: token.holderFeeSats
      });
      this.write(tokens);
      return true;
    }
    /** Update the cached collection name of a stored token (e.g. once resolved from TX1). */
    setCollectionName(txId, outputIndex, collectionName) {
      const k = outpointKey({ txId, outputIndex });
      const tokens = this.list().map((t) => outpointKey(t) === k ? { ...t, collectionName } : t);
      this.write(tokens);
    }
    /** Mark a token as sent (spent in a transfer); kept for history. */
    markSent(txId, outputIndex) {
      const k = outpointKey({ txId, outputIndex });
      const tokens = this.list().map((t) => outpointKey(t) === k ? { ...t, status: "sent" } : t);
      this.write(tokens);
    }
    remove(txId, outputIndex) {
      const k = outpointKey({ txId, outputIndex });
      this.write(this.list().filter((t) => outpointKey(t) !== k));
    }
    /** Active (held) tokens. */
    active() {
      return this.list().filter((t) => t.status === "active");
    }
  };

  // src/pushDrop.ts
  function minimalPushChunk(data) {
    if (data.length === 0) return { op: OP_default.OP_0 };
    if (data.length === 1 && data[0] === 0) return { op: OP_default.OP_0 };
    if (data.length === 1 && data[0] >= 1 && data[0] <= 16) return { op: 80 + data[0] };
    if (data.length === 1 && data[0] === 129) return { op: OP_default.OP_1NEGATE };
    if (data.length <= 75) return { op: data.length, data };
    if (data.length <= 255) return { op: OP_default.OP_PUSHDATA1, data };
    if (data.length <= 65535) return { op: OP_default.OP_PUSHDATA2, data };
    return { op: OP_default.OP_PUSHDATA4, data };
  }
  function appendDrops(chunks, count) {
    let notYetDropped = count;
    while (notYetDropped > 1) {
      chunks.push({ op: OP_default.OP_2DROP });
      notYetDropped -= 2;
    }
    if (notYetDropped === 1) chunks.push({ op: OP_default.OP_DROP });
  }
  function lock(pubKeyHex2, fields) {
    const pub = utils_exports.toArray(pubKeyHex2, "hex");
    if (pub.length !== 33 && pub.length !== 65) {
      throw new Error(`pushDrop.lock: public key must be 33 or 65 bytes, got ${pub.length}`);
    }
    const chunks = [
      { op: pub.length, data: pub },
      { op: OP_default.OP_CHECKSIG },
      ...fields.map(minimalPushChunk)
    ];
    appendDrops(chunks, fields.length);
    return new LockingScript(chunks);
  }
  function unlock(privateKey, options = {}) {
    const { signOutputs = "all", anyoneCanPay = false } = options;
    return {
      sign: async (tx, inputIndex) => {
        let scope = TransactionSignature.SIGHASH_FORKID;
        if (signOutputs === "all") scope |= TransactionSignature.SIGHASH_ALL;
        else if (signOutputs === "none") scope |= TransactionSignature.SIGHASH_NONE;
        else if (signOutputs === "single") scope |= TransactionSignature.SIGHASH_SINGLE;
        if (anyoneCanPay) scope |= TransactionSignature.SIGHASH_ANYONECANPAY;
        const input = tx.inputs[inputIndex];
        const otherInputs = tx.inputs.filter((_, i) => i !== inputIndex);
        const sourceTXID = input.sourceTXID ?? input.sourceTransaction?.id("hex");
        if (sourceTXID == null || sourceTXID === "") {
          throw new Error("pushDrop.unlock: input.sourceTXID or input.sourceTransaction is required");
        }
        const sourceSatoshis = options.sourceSatoshis ?? input.sourceTransaction?.outputs[input.sourceOutputIndex]?.satoshis;
        if (sourceSatoshis == null) {
          throw new Error("pushDrop.unlock: sourceSatoshis or input.sourceTransaction is required");
        }
        const lockingScript = options.lockingScript ?? input.sourceTransaction?.outputs[input.sourceOutputIndex]?.lockingScript;
        if (lockingScript == null) {
          throw new Error("pushDrop.unlock: lockingScript or input.sourceTransaction is required");
        }
        const preimage = TransactionSignature.format({
          sourceTXID,
          sourceOutputIndex: input.sourceOutputIndex,
          sourceSatoshis,
          transactionVersion: tx.version,
          otherInputs,
          inputIndex,
          outputs: tx.outputs,
          inputSequence: input.sequence ?? 4294967295,
          subscript: lockingScript,
          lockTime: tx.lockTime,
          scope
        });
        const rawSignature = privateKey.sign(Hash_exports.sha256(preimage));
        const sig = new TransactionSignature(rawSignature.r, rawSignature.s, scope);
        const sigForScript = sig.toChecksigFormat();
        return new UnlockingScript([{ op: sigForScript.length, data: sigForScript }]);
      },
      estimateLength: async () => 73
      // ~72-byte sig + 1 push byte
    };
  }
  function decode(script) {
    const chunks = script.chunks;
    if (chunks == null || chunks.length < 2) return null;
    const pubData = chunks[0].data;
    if (pubData == null || pubData.length !== 33 && pubData.length !== 65) return null;
    if (chunks[1].op !== OP_default.OP_CHECKSIG) return null;
    let pubKeyHex2;
    try {
      pubKeyHex2 = PublicKey.fromString(utils_exports.toHex(pubData)).toString();
    } catch {
      return null;
    }
    const fields = [];
    for (let i = 2; i < chunks.length; i++) {
      const op3 = chunks[i].op;
      if (op3 === OP_default.OP_DROP || op3 === OP_default.OP_2DROP) break;
      let data = chunks[i].data ?? [];
      if (data.length === 0) {
        if (op3 >= 81 && op3 <= 96) data = [op3 - 80];
        else if (op3 === OP_default.OP_0) data = [0];
        else if (op3 === OP_default.OP_1NEGATE) data = [129];
        else return null;
      }
      fields.push(data);
    }
    return { fields, pubKeyHex: pubKeyHex2 };
  }

  // src/tokenCodec.ts
  var P_PREFIX = [80];
  var P_VERSION = 3;
  var RECORD_TEMPLATE = 1;
  var RECORD_TOKEN = 2;
  var RECORD_FILE = 3;
  var RECORD_MESSAGE = 4;
  var RECORD_STOREFRONT = 6;
  var RECORD_NOTE = 7;
  var RECORD_PROFILE = 8;
  var RESTRICTION_FUNGIBLE = 1;
  var RESTRICTION_REPLICABLE = 2;
  var RESTRICTION_TRACK_TRANSFERS = 4;
  var RESTRICTION_ENCRYPTED = 8;
  var RESTRICTION_COMPRESSED = 16;
  function hexToBytes(hex) {
    return hex.length === 0 ? [] : utils_exports.toArray(hex, "hex");
  }
  function bytesToHex2(bytes2) {
    return utils_exports.toHex(bytes2);
  }
  function utf8ToBytes2(s2) {
    return Array.from(new TextEncoder().encode(s2));
  }
  function bytesToUtf8(bytes2) {
    return new TextDecoder().decode(new Uint8Array(bytes2));
  }
  function isEmptyOrZero(bytes2) {
    return bytes2.length === 0 || bytes2.length === 1 && bytes2[0] === 0;
  }
  function encodeTokenFields(data) {
    return [
      P_PREFIX,
      [P_VERSION],
      [RECORD_TOKEN],
      hexToBytes(data.tx1Ref),
      hexToBytes(data.stateData)
    ];
  }
  function decodeTokenFields(fields) {
    if (fields.length < 5) return null;
    if (fields[0].length !== 1 || fields[0][0] !== P_PREFIX[0]) return null;
    if (fields[1].length !== 1 || fields[1][0] !== P_VERSION) return null;
    if (fields[2].length !== 1 || fields[2][0] !== RECORD_TOKEN) return null;
    if (fields[3].length !== 32) return null;
    return {
      tx1Ref: bytesToHex2(fields[3]),
      stateData: bytesToHex2(fields[4])
    };
  }
  function buildTokenScript(ownerPubKeyHex, data) {
    return lock(ownerPubKeyHex, encodeTokenFields(data));
  }
  function parseTokenScript(script) {
    const d = decode(script);
    if (d == null) return null;
    const fields = decodeTokenFields(d.fields);
    if (fields == null) return null;
    return { ownerPubKeyHex: d.pubKeyHex, fields };
  }
  function encodeMessageFields(data) {
    return [
      P_PREFIX,
      [P_VERSION],
      [RECORD_MESSAGE],
      hexToBytes(data.ref),
      data.envelope
    ];
  }
  function decodeMessageFields(fields) {
    if (fields.length < 5) return null;
    if (fields[0].length !== 1 || fields[0][0] !== P_PREFIX[0]) return null;
    if (fields[1].length !== 1 || fields[1][0] !== P_VERSION) return null;
    if (fields[2].length !== 1 || fields[2][0] !== RECORD_MESSAGE) return null;
    if (fields[3].length !== 32) return null;
    return {
      ref: bytesToHex2(fields[3]),
      envelope: fields[4]
    };
  }
  function buildMessageScript(recipientPubKeyHex, data) {
    return lock(recipientPubKeyHex, encodeMessageFields(data));
  }
  function parseMessageScript(script) {
    const d = decode(script);
    if (d == null) return null;
    const fields = decodeMessageFields(d.fields);
    if (fields == null) return null;
    return { recipientPubKeyHex: d.pubKeyHex, fields };
  }
  function encodeTemplateFields(data) {
    const fields = [
      P_PREFIX,
      [P_VERSION],
      [RECORD_TEMPLATE],
      utf8ToBytes2(data.tokenName),
      hexToBytes(data.tokenRules),
      hexToBytes(data.covenantScript)
    ];
    if (data.fileHash != null && data.fileHash.length > 0) {
      fields.push(hexToBytes(data.fileHash));
      if (data.wrappedKey != null && data.keySalt != null) {
        fields.push(data.wrappedKey, data.keySalt);
      }
    }
    return fields;
  }
  function decodeTemplateFields(fields) {
    if (fields.length < 6) return null;
    if (fields[0].length !== 1 || fields[0][0] !== P_PREFIX[0]) return null;
    if (fields[1].length !== 1 || fields[1][0] !== P_VERSION) return null;
    if (fields[2].length !== 1 || fields[2][0] !== RECORD_TEMPLATE) return null;
    const result = {
      tokenName: bytesToUtf8(fields[3]),
      tokenRules: bytesToHex2(fields[4]),
      // Empty covenant normalizes to "00" via OP_0; treat that as "no covenant".
      covenantScript: isEmptyOrZero(fields[5]) ? "" : bytesToHex2(fields[5])
    };
    if (fields.length >= 7 && fields[6].length === 32) {
      result.fileHash = bytesToHex2(fields[6]);
    }
    if (fields.length >= 9) {
      result.wrappedKey = fields[7];
      result.keySalt = fields[8];
    }
    return result;
  }
  function buildTemplateScript(publisherPubKeyHex, data) {
    return lock(publisherPubKeyHex, encodeTemplateFields(data));
  }
  function parseTemplateScript(script) {
    const d = decode(script);
    if (d == null) return null;
    const fields = decodeTemplateFields(d.fields);
    if (fields == null) return null;
    return { publisherPubKeyHex: d.pubKeyHex, fields };
  }
  function encodeFileFields(data) {
    return [
      P_PREFIX,
      [P_VERSION],
      [RECORD_FILE],
      utf8ToBytes2(data.mimeType),
      utf8ToBytes2(data.fileName),
      data.fileBytes
    ];
  }
  function decodeFileFields(fields) {
    if (fields.length < 6) return null;
    if (fields[0].length !== 1 || fields[0][0] !== P_PREFIX[0]) return null;
    if (fields[1].length !== 1 || fields[1][0] !== P_VERSION) return null;
    if (fields[2].length !== 1 || fields[2][0] !== RECORD_FILE) return null;
    return {
      mimeType: bytesToUtf8(fields[3]),
      fileName: bytesToUtf8(fields[4]),
      fileBytes: fields[5]
    };
  }
  function buildFileScript(publisherPubKeyHex, data) {
    return lock(publisherPubKeyHex, encodeFileFields(data));
  }
  function parseFileScript(script) {
    const d = decode(script);
    if (d == null) return null;
    const fields = decodeFileFields(d.fields);
    if (fields == null) return null;
    return { publisherPubKeyHex: d.pubKeyHex, fields };
  }
  function encodeStorefrontFields(data) {
    return [
      P_PREFIX,
      [P_VERSION],
      [RECORD_STOREFRONT],
      utf8ToBytes2(data.description ?? ""),
      utf8ToBytes2(data.coverMimeType ?? ""),
      utf8ToBytes2(data.coverFileName ?? ""),
      data.coverBytes ?? []
    ];
  }
  function decodeStorefrontFields(fields) {
    if (fields.length < 7) return null;
    if (fields[0].length !== 1 || fields[0][0] !== P_PREFIX[0]) return null;
    if (fields[1].length !== 1 || fields[1][0] !== P_VERSION) return null;
    if (fields[2].length !== 1 || fields[2][0] !== RECORD_STOREFRONT) return null;
    const hasCover = !isEmptyOrZero(fields[6]);
    return {
      description: isEmptyOrZero(fields[3]) ? "" : bytesToUtf8(fields[3]),
      coverMimeType: hasCover ? bytesToUtf8(fields[4]) : void 0,
      coverFileName: hasCover ? bytesToUtf8(fields[5]) : void 0,
      coverBytes: hasCover ? fields[6] : void 0
    };
  }
  function buildStorefrontScript(publisherPubKeyHex, data) {
    return lock(publisherPubKeyHex, encodeStorefrontFields(data));
  }
  function parseStorefrontScript(script) {
    const d = decode(script);
    if (d == null) return null;
    const fields = decodeStorefrontFields(d.fields);
    if (fields == null) return null;
    return { publisherPubKeyHex: d.pubKeyHex, fields };
  }
  function encodeProfileFields(data) {
    return [
      P_PREFIX,
      [P_VERSION],
      [RECORD_PROFILE],
      utf8ToBytes2(data.alias ?? ""),
      utf8ToBytes2(data.avatarMimeType ?? ""),
      data.avatarBytes ?? []
    ];
  }
  function decodeProfileFields(fields) {
    if (fields.length < 6) return null;
    if (fields[0].length !== 1 || fields[0][0] !== P_PREFIX[0]) return null;
    if (fields[1].length !== 1 || fields[1][0] !== P_VERSION) return null;
    if (fields[2].length !== 1 || fields[2][0] !== RECORD_PROFILE) return null;
    const hasAvatar = !isEmptyOrZero(fields[5]);
    return {
      alias: isEmptyOrZero(fields[3]) ? void 0 : bytesToUtf8(fields[3]),
      avatarMimeType: hasAvatar ? bytesToUtf8(fields[4]) : void 0,
      avatarBytes: hasAvatar ? fields[5] : void 0
    };
  }
  function buildProfileScript(ownerPubKeyHex, data) {
    return lock(ownerPubKeyHex, encodeProfileFields(data));
  }
  function parseProfileScript(script) {
    const d = decode(script);
    if (d == null) return null;
    const fields = decodeProfileFields(d.fields);
    if (fields == null) return null;
    return { ownerPubKeyHex: d.pubKeyHex, fields };
  }
  var BONUS_LINK = 1;
  var BONUS_CODE = 2;
  function encodeNoteFields(data) {
    const fields = [
      P_PREFIX,
      [P_VERSION],
      [RECORD_NOTE],
      hexToBytes(data.collectionRef),
      utf8ToBytes2(data.text)
    ];
    if (data.bonusKind != null && data.bonusValue != null && data.bonusValue.length > 0) {
      fields.push([data.bonusKind === "link" ? BONUS_LINK : BONUS_CODE], utf8ToBytes2(data.bonusValue));
    }
    return fields;
  }
  function decodeNoteFields(fields) {
    if (fields.length < 5) return null;
    if (fields[0].length !== 1 || fields[0][0] !== P_PREFIX[0]) return null;
    if (fields[1].length !== 1 || fields[1][0] !== P_VERSION) return null;
    if (fields[2].length !== 1 || fields[2][0] !== RECORD_NOTE) return null;
    if (fields[3].length !== 32) return null;
    const result = {
      collectionRef: bytesToHex2(fields[3]),
      text: isEmptyOrZero(fields[4]) ? "" : bytesToUtf8(fields[4])
    };
    if (fields.length >= 7 && fields[5].length === 1 && (fields[5][0] === BONUS_LINK || fields[5][0] === BONUS_CODE)) {
      result.bonusKind = fields[5][0] === BONUS_LINK ? "link" : "code";
      result.bonusValue = bytesToUtf8(fields[6]);
    }
    return result;
  }
  function buildNoteScript(authorPubKeyHex, data) {
    return lock(authorPubKeyHex, encodeNoteFields(data));
  }
  function parseNoteScript(script) {
    const d = decode(script);
    if (d == null) return null;
    const fields = decodeNoteFields(d.fields);
    if (fields == null) return null;
    return { authorPubKeyHex: d.pubKeyHex, fields };
  }
  function encodeTokenRules(supply, divisibility, restrictions, version) {
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    view.setUint16(0, supply, true);
    view.setUint16(2, divisibility, true);
    view.setUint16(4, restrictions, true);
    view.setUint16(6, version, true);
    return bytesToHex2(Array.from(new Uint8Array(buf)));
  }
  function decodeTokenRules(rulesHex) {
    const bytes2 = hexToBytes(rulesHex);
    const view = new DataView(new Uint8Array(bytes2).buffer);
    const supply = view.getUint16(0, true);
    const restrictions = view.getUint16(4, true);
    return {
      supply,
      divisibility: view.getUint16(2, true),
      restrictions,
      version: view.getUint16(6, true),
      isFungible: (restrictions & RESTRICTION_FUNGIBLE) !== 0,
      isReplicable: (restrictions & RESTRICTION_REPLICABLE) !== 0,
      isUnlimited: supply === 0,
      isTracked: (restrictions & RESTRICTION_TRACK_TRANSFERS) !== 0,
      isEncrypted: (restrictions & RESTRICTION_ENCRYPTED) !== 0,
      isCompressed: (restrictions & RESTRICTION_COMPRESSED) !== 0
    };
  }

  // src/collectionBuilder.ts
  var PHARLAP_OUTPUT_SATS = 1;
  var DEFAULT_FEE_PER_KB = 100;
  async function getSafeUtxos(provider2) {
    const utxos = await provider2.getUtxos();
    return utxos.filter((u) => u.satoshis > PHARLAP_OUTPUT_SATS);
  }
  function selectFunding(utxos, target) {
    const sorted = [...utxos].sort((a, b) => b.satoshis - a.satoshis);
    const picked = [];
    let total = 0;
    for (const u of sorted) {
      picked.push(u);
      total += u.satoshis;
      if (total >= target) return picked;
    }
    throw new Error(`Insufficient funds: have ${total} sats, need ~${target}`);
  }
  function sha256Hex(bytes2) {
    return utils_exports.toHex(Hash_exports.sha256(bytes2));
  }
  async function buildTemplateTx(opts) {
    const sats = opts.outputSats ?? PHARLAP_OUTPUT_SATS;
    const publisherPub = opts.key.toPublicKey().toString();
    const address2 = opts.key.toAddress();
    const tx = new Transaction();
    for (const f2 of opts.funding) {
      tx.addInput({
        sourceTransaction: f2.sourceTx,
        sourceOutputIndex: f2.utxo.outputIndex,
        unlockingScriptTemplate: new P2PKH().unlock(opts.key)
      });
    }
    tx.addOutput({ lockingScript: buildTemplateScript(publisherPub, opts.template), satoshis: sats });
    const templateVout = 0;
    let fileVout = null;
    if (opts.file) {
      fileVout = tx.outputs.length;
      tx.addOutput({ lockingScript: buildFileScript(publisherPub, opts.file), satoshis: sats });
    }
    let storefrontVout = null;
    if (opts.storefront) {
      storefrontVout = tx.outputs.length;
      tx.addOutput({ lockingScript: buildStorefrontScript(publisherPub, opts.storefront), satoshis: sats });
    }
    const changeVout = tx.outputs.length;
    tx.addOutput({ lockingScript: new P2PKH().lock(address2), change: true });
    await tx.fee(new SatoshisPerKilobyte(opts.feePerKb ?? DEFAULT_FEE_PER_KB));
    await tx.sign();
    const changeSats = tx.outputs[changeVout]?.satoshis ?? 0;
    return {
      tx,
      tx1Id: tx.id("hex"),
      templateVout,
      fileVout,
      storefrontVout,
      changeVout: changeSats > 0 ? changeVout : null,
      changeSats
    };
  }
  async function buildGenesisTx(opts) {
    if (opts.mintCount < 1) throw new Error("mintCount must be >= 1");
    const sats = opts.outputSats ?? PHARLAP_OUTPUT_SATS;
    const ownerPub = opts.key.toPublicKey().toString();
    const address2 = opts.key.toAddress();
    const stateData = opts.stateData ?? "";
    const tx = new Transaction();
    for (const f2 of opts.funding) {
      tx.addInput({
        sourceTransaction: f2.sourceTx,
        sourceOutputIndex: f2.utxo.outputIndex,
        unlockingScriptTemplate: new P2PKH().unlock(opts.key)
      });
    }
    const tokenVouts = [];
    for (let i = 0; i < opts.mintCount; i++) {
      tokenVouts.push(tx.outputs.length);
      tx.addOutput({
        lockingScript: buildTokenScript(ownerPub, { tx1Ref: opts.tx1Id, stateData }),
        satoshis: sats
      });
    }
    const changeVout = tx.outputs.length;
    tx.addOutput({ lockingScript: new P2PKH().lock(address2), change: true });
    await tx.fee(new SatoshisPerKilobyte(opts.feePerKb ?? DEFAULT_FEE_PER_KB));
    await tx.sign();
    const changeSats = tx.outputs[changeVout]?.satoshis ?? 0;
    return {
      tx,
      tx2Id: tx.id("hex"),
      tokenVouts,
      changeVout: changeSats > 0 ? changeVout : null,
      changeSats
    };
  }
  var SPEND_CANCELLED = "SPEND_CANCELLED";
  function spentSats(selected, finalChangeSats) {
    return selected.reduce((s2, u) => s2 + u.satoshis, 0) - finalChangeSats;
  }
  async function createCollection(provider2, key2, params) {
    const sats = params.outputSats ?? PHARLAP_OUTPUT_SATS;
    const feePerKb = params.feePerKb ?? DEFAULT_FEE_PER_KB;
    const supply = params.supply ?? 1;
    const mintCount = params.mintCount ?? (supply > 0 ? supply : 1);
    const template = {
      tokenName: params.tokenName,
      tokenRules: encodeTokenRules(supply, params.divisibility ?? 0, params.restrictions ?? 0, params.rulesVersion ?? 1),
      covenantScript: params.covenantScript ?? "",
      fileHash: params.file ? sha256Hex(params.file.bytes) : void 0
    };
    const file = params.file ? { mimeType: params.file.mimeType, fileName: params.file.fileName, fileBytes: params.file.bytes } : void 0;
    const numOutputs = 1 + (file ? 1 : 0) + mintCount;
    const tx1Bytes = 400 + (file ? file.fileBytes.length : 0);
    const tx2Bytes = 300 + mintCount * 80;
    const estFee = Math.ceil((tx1Bytes + tx2Bytes) * feePerKb / 1e3);
    const target = numOutputs * sats + estFee + Math.max(1e3, Math.ceil(estFee * 0.1));
    const selected = selectFunding(await getSafeUtxos(provider2), target);
    const funding = await Promise.all(
      selected.map(async (u) => ({ utxo: u, sourceTx: await provider2.getSourceTransaction(u.txId) }))
    );
    const t1 = await buildTemplateTx({ key: key2, funding, template, file, outputSats: sats, feePerKb });
    if (t1.changeVout == null) {
      throw new Error("Insufficient funding: the template tx left no change to fund the genesis mint. Add more funds.");
    }
    const t2Funding = [
      {
        utxo: { txId: t1.tx1Id, outputIndex: t1.changeVout, satoshis: t1.changeSats, script: "" },
        sourceTx: t1.tx
      }
    ];
    const t2 = await buildGenesisTx({
      key: key2,
      funding: t2Funding,
      tx1Id: t1.tx1Id,
      mintCount,
      stateData: params.initialStateData ?? "",
      outputSats: sats,
      feePerKb
    });
    if (params.confirmSpend != null && !await params.confirmSpend(spentSats(selected, t2.changeSats))) {
      throw new Error(SPEND_CANCELLED);
    }
    await provider2.broadcast(t1.tx.toHex());
    provider2.registerPendingTx(
      t1.tx1Id,
      selected.map((u) => ({ txId: u.txId, outputIndex: u.outputIndex })),
      { outputIndex: t1.changeVout, satoshis: t1.changeSats }
    );
    await provider2.broadcast(t2.tx.toHex());
    provider2.registerPendingTx(
      t2.tx2Id,
      [{ txId: t1.tx1Id, outputIndex: t1.changeVout }],
      t2.changeVout != null ? { outputIndex: t2.changeVout, satoshis: t2.changeSats } : void 0
    );
    return {
      collectionId: t1.tx1Id,
      tx1Id: t1.tx1Id,
      tx2Id: t2.tx2Id,
      tokenOutpoints: t2.tokenVouts.map((v) => ({ txId: t2.tx2Id, outputIndex: v }))
    };
  }

  // src/pushtx.ts
  var SIGHASH_ALL_FORKID = 65;
  var A_HEX = "11".repeat(32);
  var K_HEX = "22".repeat(32);
  function toScriptNumLE(bn) {
    if (bn.isZero()) return [];
    const le = bn.toArray("le");
    if ((le[le.length - 1] & 128) !== 0) le.push(0);
    return le;
  }
  function minimalBE(bn) {
    const be = bn.toArray("be");
    if ((be[0] & 128) !== 0) be.unshift(0);
    return be;
  }
  function pushTxConstants(scope = SIGHASH_ALL_FORKID) {
    const curve2 = new Curve();
    const n = curve2.n;
    const aKey = PrivateKey.fromString(A_HEX, 16);
    const kKey = PrivateKey.fromString(K_HEX, 16);
    const a = new BigNumber(aKey.toArray());
    const k = new BigNumber(kKey.toArray());
    const r2 = kKey.toPublicKey().x.umod(n);
    const rBE = minimalBE(r2);
    return {
      Qbytes: aKey.toPublicKey().encode(true),
      rDerInt: [2, rBE.length, ...rBE],
      raLE: toScriptNumLE(r2.mul(a).umod(n)),
      nLE: toScriptNumLE(n),
      kInvLE: toScriptNumLE(k.invm(n)),
      scope
    };
  }
  var op = (code) => ({ op: code });
  function push(data) {
    if (data.length < 76) return { op: data.length, data };
    if (data.length < 256) return { op: OP_default.OP_PUSHDATA1, data };
    if (data.length < 65536) return { op: OP_default.OP_PUSHDATA2, data };
    return { op: OP_default.OP_PUSHDATA4, data };
  }
  function reverseBytesOps(len) {
    const ops = [];
    for (let i = 0; i < len - 1; i++) ops.push(op(OP_default.OP_1), op(OP_default.OP_SPLIT));
    for (let i = 0; i < len - 1; i++) ops.push(op(OP_default.OP_SWAP), op(OP_default.OP_CAT));
    return ops;
  }
  function deriveSigOps(c) {
    return [
      // e = HASH256(preimage) as a positive script number (reverse BE→LE, append sign byte, minimise)
      op(OP_default.OP_HASH256),
      ...reverseBytesOps(32),
      push([0]),
      op(OP_default.OP_CAT),
      op(OP_default.OP_BIN2NUM),
      // s = k⁻¹·((e + r·a) mod n) mod n
      push(c.raLE),
      op(OP_default.OP_ADD),
      push(c.nLE),
      op(OP_default.OP_MOD),
      push(c.kInvLE),
      op(OP_default.OP_MUL),
      push(c.nLE),
      op(OP_default.OP_MOD),
      // s (LE number) → minimal-DER integer: NUM2BIN(33) → reverse → strip leading zeros at 33−size
      op(OP_default.OP_SIZE),
      push([33]),
      op(OP_default.OP_SWAP),
      op(OP_default.OP_SUB),
      op(OP_default.OP_TOALTSTACK),
      push([33]),
      op(OP_default.OP_NUM2BIN),
      ...reverseBytesOps(33),
      op(OP_default.OP_FROMALTSTACK),
      op(OP_default.OP_SPLIT),
      op(OP_default.OP_NIP),
      op(OP_default.OP_SIZE),
      op(OP_default.OP_SWAP),
      op(OP_default.OP_CAT),
      // <len> ++ sBE
      push([2]),
      op(OP_default.OP_SWAP),
      op(OP_default.OP_CAT),
      // 0x02 ++ <len> ++ sBE
      // assemble full sig: 0x30 <bodylen> rDerInt sDerInt <scope>
      push(c.rDerInt),
      op(OP_default.OP_SWAP),
      op(OP_default.OP_CAT),
      op(OP_default.OP_SIZE),
      op(OP_default.OP_SWAP),
      op(OP_default.OP_CAT),
      push([48]),
      op(OP_default.OP_SWAP),
      op(OP_default.OP_CAT),
      push([c.scope]),
      op(OP_default.OP_CAT)
    ];
  }
  function pushTxVerifyOps(c = pushTxConstants()) {
    return [
      op(OP_default.OP_DUP),
      ...deriveSigOps(c),
      push(c.Qbytes),
      op(OP_default.OP_CHECKSIG),
      op(OP_default.OP_VERIFY)
    ];
  }
  var pushData = push;

  // src/covenant.ts
  var op2 = (code) => ({ op: code });
  function u64le(n) {
    const out = [];
    let v = n;
    for (let i = 0; i < 8; i++) {
      out.push(v & 255);
      v = Math.floor(v / 256);
    }
    return out;
  }
  function numLE(n) {
    if (n === 0) return [];
    const out = [];
    let v = n;
    while (v > 0) {
      out.push(v & 255);
      v = Math.floor(v / 256);
    }
    if ((out[out.length - 1] & 128) !== 0) out.push(0);
    return out;
  }
  function varInt(n) {
    if (n < 253) return [n];
    if (n <= 65535) return [253, n & 255, n >> 8 & 255];
    if (n <= 4294967295) return [254, n & 255, n >> 8 & 255, n >> 16 & 255, n >> 24 & 255];
    throw new Error("varInt: value too large");
  }
  function serializeOutput(satoshis, scriptBytes) {
    return [...u64le(satoshis), ...varInt(scriptBytes.length), ...scriptBytes];
  }
  function p2pkhScript(hash20) {
    return [118, 169, 20, ...hash20, 136, 172];
  }
  function extractHashOutputsOps() {
    return [
      op2(OP_default.OP_SIZE),
      pushData([40]),
      op2(OP_default.OP_SUB),
      op2(OP_default.OP_SPLIT),
      op2(OP_default.OP_NIP),
      // tail 40 bytes
      pushData([32]),
      op2(OP_default.OP_SPLIT),
      op2(OP_default.OP_DROP)
      // first 32 = hashOutputs
    ];
  }
  function extractScriptCodeFieldOps() {
    return [
      pushData([104]),
      op2(OP_default.OP_SPLIT),
      op2(OP_default.OP_NIP),
      // drop 104-byte prefix
      op2(OP_default.OP_SIZE),
      pushData([52]),
      op2(OP_default.OP_SUB),
      op2(OP_default.OP_SPLIT),
      op2(OP_default.OP_DROP)
      // drop 52-byte suffix
    ];
  }
  function covenantPrefixOps(fieldPubkeyOffset, c = pushTxConstants()) {
    return [
      ...pushTxVerifyOps(c),
      op2(OP_default.OP_DUP),
      ...extractHashOutputsOps(),
      op2(OP_default.OP_TOALTSTACK),
      // alt:[hashOutputs]
      ...extractScriptCodeFieldOps(),
      // [ ..., scFld ]
      pushData(numLE(fieldPubkeyOffset)),
      op2(OP_default.OP_SPLIT),
      // [ ..., pre, ownerPub‖suffix ]
      pushData([33]),
      op2(OP_default.OP_SPLIT)
      // [ ..., pre, ownerPub, suffix ]
    ];
  }
  function replicateTailOps(p) {
    const VALUE1 = u64le(p.tokenSats ?? 1);
    const OUT2 = serializeOutput(p.publisherFeeSats, p2pkhScript(p.publisherPubKeyHash));
    const C3pre = [...u64le(p.holderFeeSats), 25, 118, 169, 20];
    const C3suf = [136, 172];
    return [
      // out0 = VALUE1 ‖ pre ‖ ownerPub ‖ suffix (token back to holder, verbatim)
      pushData(VALUE1),
      pushData([3]),
      op2(OP_default.OP_PICK),
      op2(OP_default.OP_CAT),
      pushData([2]),
      op2(OP_default.OP_PICK),
      op2(OP_default.OP_CAT),
      pushData([1]),
      op2(OP_default.OP_PICK),
      op2(OP_default.OP_CAT),
      // out1 = VALUE1 ‖ pre ‖ buyerPub ‖ suffix (replica to buyer)
      pushData(VALUE1),
      pushData([4]),
      op2(OP_default.OP_PICK),
      op2(OP_default.OP_CAT),
      pushData([5]),
      op2(OP_default.OP_PICK),
      op2(OP_default.OP_CAT),
      pushData([2]),
      op2(OP_default.OP_PICK),
      op2(OP_default.OP_CAT),
      op2(OP_default.OP_CAT),
      // out0 ‖ out1
      pushData(OUT2),
      op2(OP_default.OP_CAT),
      // ‖ out2 (publisher fee, constant)
      pushData(C3pre),
      op2(OP_default.OP_CAT),
      pushData([2]),
      op2(OP_default.OP_PICK),
      op2(OP_default.OP_HASH160),
      op2(OP_default.OP_CAT),
      // ‖ HASH160(ownerPub)
      pushData(C3suf),
      op2(OP_default.OP_CAT),
      // → out3 (holder fee)
      pushData([5]),
      op2(OP_default.OP_ROLL),
      op2(OP_default.OP_CAT),
      // ‖ buyerChange → expected
      op2(OP_default.OP_TOALTSTACK),
      op2(OP_default.OP_2DROP),
      op2(OP_default.OP_2DROP),
      // stash expected; drop 4 leftover pieces
      op2(OP_default.OP_FROMALTSTACK),
      op2(OP_default.OP_HASH256),
      op2(OP_default.OP_FROMALTSTACK),
      op2(OP_default.OP_EQUAL)
    ];
  }
  function transferTailOps(p) {
    const VALUE1 = u64le(p.tokenSats ?? 1);
    return [
      // authenticate current owner: <ownerSig> <ownerPub> OP_CHECKSIGVERIFY
      pushData([1]),
      op2(OP_default.OP_PICK),
      // copy ownerPub
      pushData([4]),
      op2(OP_default.OP_PICK),
      // copy ownerSig
      op2(OP_default.OP_SWAP),
      op2(OP_default.OP_CHECKSIGVERIFY),
      // out0 = VALUE1 ‖ pre ‖ newOwnerPub ‖ suffix
      pushData(VALUE1),
      pushData([3]),
      op2(OP_default.OP_PICK),
      op2(OP_default.OP_CAT),
      // ‖ pre
      pushData([5]),
      op2(OP_default.OP_PICK),
      op2(OP_default.OP_CAT),
      // ‖ newOwnerPub
      pushData([1]),
      op2(OP_default.OP_PICK),
      op2(OP_default.OP_CAT),
      // ‖ suffix → out0
      pushData([6]),
      op2(OP_default.OP_ROLL),
      op2(OP_default.OP_CAT),
      // ‖ change → expected
      op2(OP_default.OP_TOALTSTACK),
      op2(OP_default.OP_2DROP),
      op2(OP_default.OP_2DROP),
      op2(OP_default.OP_DROP),
      // drop 5 leftover pieces
      op2(OP_default.OP_FROMALTSTACK),
      op2(OP_default.OP_HASH256),
      op2(OP_default.OP_FROMALTSTACK),
      op2(OP_default.OP_EQUAL)
    ];
  }
  function burnTailOps() {
    return [
      // authenticate current owner: <ownerSig> <ownerPub> OP_CHECKSIGVERIFY  (same auth as transferTailOps)
      pushData([1]),
      op2(OP_default.OP_PICK),
      // copy ownerPub
      pushData([4]),
      op2(OP_default.OP_PICK),
      // copy ownerSig
      op2(OP_default.OP_SWAP),
      op2(OP_default.OP_CHECKSIGVERIFY),
      // burn: enforce nothing — the owner authorised their outputs by signing. Clean up + succeed.
      op2(OP_default.OP_2DROP),
      op2(OP_default.OP_2DROP),
      // drop suffix, ownerPub, pre, ownerSig
      op2(OP_default.OP_FROMALTSTACK),
      op2(OP_default.OP_DROP),
      // discard hashOutputs (unused by burn)
      op2(OP_default.OP_1)
    ];
  }
  var EDITION_SCOPE = 193;
  var RECORD_EDITION = 5;
  function serializedPushLen(data) {
    if (data.length < 76) return 1 + data.length;
    if (data.length < 256) return 2 + data.length;
    if (data.length < 65536) return 3 + data.length;
    return 5 + data.length;
  }
  function editionFieldChunks(f2) {
    return [
      pushData(f2.prefix ?? [80]),
      pushData(f2.version ?? [3]),
      pushData([RECORD_EDITION]),
      pushData(f2.tx1Ref),
      pushData(f2.ownerPubKey)
    ];
  }
  function editionLockOps(p) {
    const c = p.c ?? pushTxConstants(EDITION_SCOPE);
    return [
      ...editionFieldChunks(p),
      op2(OP_default.OP_2DROP),
      op2(OP_default.OP_2DROP),
      op2(OP_default.OP_DROP),
      // 5 fields
      ...covenantPrefixOps(p.fieldPubkeyOffset, c),
      pushData([3]),
      op2(OP_default.OP_ROLL),
      // bring the branch selector to the top
      op2(OP_default.OP_DUP),
      op2(OP_default.OP_2),
      op2(OP_default.OP_NUMEQUAL),
      op2(OP_default.OP_IF),
      // selector == 2 → burn
      op2(OP_default.OP_DROP),
      // drop the selector
      ...burnTailOps(),
      op2(OP_default.OP_ELSE),
      // selector 1 → transfer, 0 → replicate
      op2(OP_default.OP_IF),
      ...transferTailOps({ tokenSats: p.tokenSats }),
      op2(OP_default.OP_ELSE),
      ...replicateTailOps(p),
      op2(OP_default.OP_ENDIF),
      op2(OP_default.OP_ENDIF)
    ];
  }
  function buildEditionLock(p) {
    const before = [p.prefix ?? [80], p.version ?? [3], [RECORD_EDITION], p.tx1Ref];
    const O = before.reduce((s2, f2) => s2 + serializedPushLen(f2), 0) + 1;
    const probeLen = new LockingScript(editionLockOps({ ...p, fieldPubkeyOffset: 1 })).toBinary().length;
    const varIntSize = probeLen < 253 ? 1 : probeLen < 65536 ? 3 : 5;
    return new LockingScript(editionLockOps({ ...p, fieldPubkeyOffset: varIntSize + O }));
  }
  function editionSupportsBurn(lockBytes) {
    const chunks = LockingScript.fromBinary(lockBytes).chunks;
    return chunks != null && chunks.some((c) => c.op === OP_default.OP_NUMEQUAL);
  }
  var EDITION_VERSION_V2 = 4;
  var EDITION_OWNER_SCRIPT_OFFSET = 40;
  function swapEditionOwner(lockBytes, newOwnerPub) {
    if (newOwnerPub.length !== 33) throw new Error("swapEditionOwner: owner pubkey must be 33 bytes");
    const out = [...lockBytes];
    for (let i = 0; i < 33; i++) out[EDITION_OWNER_SCRIPT_OFFSET + i] = newOwnerPub[i];
    return out;
  }
  var EDITION_TX1REF_SCRIPT_OFFSET = 7;
  function buildHolderEditionScript(templateCovenantBytes, tx1Ref, ownerPub) {
    if (tx1Ref.length !== 32) throw new Error("buildHolderEditionScript: tx1Ref must be 32 bytes");
    if (ownerPub.length !== 33) throw new Error("buildHolderEditionScript: owner pubkey must be 33 bytes");
    const out = [...templateCovenantBytes];
    for (let i = 0; i < 32; i++) out[EDITION_TX1REF_SCRIPT_OFFSET + i] = tx1Ref[i];
    for (let i = 0; i < 33; i++) out[EDITION_OWNER_SCRIPT_OFFSET + i] = ownerPub[i];
    return out;
  }
  function editionOwnerPubKey(lockBytes) {
    return lockBytes.slice(EDITION_OWNER_SCRIPT_OFFSET, EDITION_OWNER_SCRIPT_OFFSET + 33);
  }
  function chunkBytes(c) {
    if (c.data != null && c.data.length > 0) return c.data;
    if (c.op === OP_default.OP_0) return [];
    if (c.op >= 81 && c.op <= 96) return [c.op - 80];
    if (c.op === OP_default.OP_1NEGATE) return [129];
    return null;
  }
  function leToNum(b) {
    let n = 0;
    for (let i = b.length - 1; i >= 0; i--) n = n * 256 + b[i];
    return n;
  }
  function parseEditionScript(script) {
    const ch = script.chunks;
    if (ch == null || ch.length < 8) return null;
    const P2 = chunkBytes(ch[0]);
    const ver = chunkBytes(ch[1]);
    const rec = chunkBytes(ch[2]);
    const tx1Ref = chunkBytes(ch[3]);
    const ownerPub = chunkBytes(ch[4]);
    if (P2 == null || P2.length !== 1 || P2[0] !== 80) return null;
    if (ver == null || ver[0] !== 3) return null;
    if (rec == null || rec[0] !== RECORD_EDITION) return null;
    if (tx1Ref == null || tx1Ref.length !== 32) return null;
    if (ownerPub == null || ownerPub.length !== 33) return null;
    if (ch[5].op !== OP_default.OP_2DROP || ch[6].op !== OP_default.OP_2DROP || ch[7].op !== OP_default.OP_DROP) return null;
    let publisherFeeSats = 0, holderFeeSats = 0;
    let publisherPubKeyHash = null;
    const isP2pkhValue = (d) => d[8] === 25 && d[9] === 118 && d[10] === 169 && d[11] === 20;
    for (const c of ch) {
      const d = chunkBytes(c);
      if (d == null) continue;
      if (d.length === 34 && isP2pkhValue(d)) {
        publisherFeeSats = leToNum(d.slice(0, 8));
        publisherPubKeyHash = d.slice(12, 32);
      } else if (d.length === 12 && isP2pkhValue(d)) {
        holderFeeSats = leToNum(d.slice(0, 8));
      }
    }
    if (publisherPubKeyHash == null) return null;
    return {
      tx1RefHex: utils_exports.toHex(tx1Ref),
      ownerPubKeyHex: utils_exports.toHex(ownerPub),
      priceSats: 0,
      stateDataHex: "",
      terms: { publisherPubKeyHash, publisherFeeSats, holderFeeSats }
    };
  }
  function parseEditionScriptV2(script) {
    const ch = script.chunks;
    if (ch == null || ch.length < 11) return null;
    const P2 = chunkBytes(ch[0]);
    const ver = chunkBytes(ch[1]);
    const rec = chunkBytes(ch[2]);
    const tx1Ref = chunkBytes(ch[3]);
    const ownerPub = chunkBytes(ch[4]);
    const price = chunkBytes(ch[5]);
    const stateData = chunkBytes(ch[6]) ?? [];
    if (P2 == null || P2.length !== 1 || P2[0] !== 80) return null;
    if (ver == null || ver[0] !== EDITION_VERSION_V2) return null;
    if (rec == null || rec[0] !== RECORD_EDITION) return null;
    if (tx1Ref == null || tx1Ref.length !== 32) return null;
    if (ownerPub == null || ownerPub.length !== 33) return null;
    if (price == null || price.length !== 8) return null;
    if (ch[7].op !== OP_default.OP_2DROP || ch[8].op !== OP_default.OP_2DROP || ch[9].op !== OP_default.OP_2DROP || ch[10].op !== OP_default.OP_DROP) return null;
    let publisherPubKeyHash = null;
    let pBps = null;
    for (let i = 0; i < ch.length; i++) {
      const d = chunkBytes(ch[i]);
      if (d != null && d.length === 26 && d[0] === 25 && d[1] === 118 && d[2] === 169 && d[3] === 20 && d[24] === 136 && d[25] === 172) {
        publisherPubKeyHash = d.slice(4, 24);
      }
      if (ch[i + 1]?.op === OP_default.OP_MUL && ch[i + 3]?.op === OP_default.OP_DIV) {
        const tenK = chunkBytes(ch[i + 2]);
        const cb = chunkBytes(ch[i]);
        if (tenK != null && tenK.length === 2 && tenK[0] === 16 && tenK[1] === 39 && cb != null) pBps = leToNum(cb);
      }
    }
    if (publisherPubKeyHash == null || pBps == null) return null;
    return {
      tx1RefHex: utils_exports.toHex(tx1Ref),
      ownerPubKeyHex: utils_exports.toHex(ownerPub),
      priceSats: leToNum(price),
      stateDataHex: utils_exports.toHex(stateData),
      terms: { publisherPubKeyHash, pBps }
    };
  }
  function parseEditionAny(script) {
    const v2 = parseEditionScriptV2(script);
    if (v2 != null) {
      return {
        tx1RefHex: v2.tx1RefHex,
        ownerPubKeyHex: v2.ownerPubKeyHex,
        priceSats: v2.priceSats,
        stateDataHex: v2.stateDataHex,
        isV2: true,
        terms: { publisherPubKeyHash: v2.terms.publisherPubKeyHash, publisherFeeSats: 0, holderFeeSats: 0, pBps: v2.terms.pBps }
      };
    }
    const v1 = parseEditionScript(script);
    if (v1 != null) {
      return {
        tx1RefHex: v1.tx1RefHex,
        ownerPubKeyHex: v1.ownerPubKeyHex,
        priceSats: 0,
        stateDataHex: v1.stateDataHex,
        isV2: false,
        terms: { ...v1.terms, pBps: 0 }
      };
    }
    return null;
  }
  function editionReplicateUnlockChunks(p) {
    return [pushData(p.buyerChange), pushData(p.buyerPubKey), op2(OP_default.OP_0), pushData(p.preimage)];
  }
  function editionTransferUnlockChunks(p) {
    return [pushData(p.change), pushData(p.newOwnerPubKey), pushData(p.ownerSig), op2(OP_default.OP_1), pushData(p.preimage)];
  }
  function editionBurnUnlockChunks(p) {
    return [pushData(p.ownerSig), op2(OP_default.OP_2), pushData(p.preimage)];
  }

  // src/compress.ts
  var MIN_COMPRESS = 64;
  async function run(bytes2, stream) {
    const writer = stream.writable.getWriter();
    void writer.write(new Uint8Array(bytes2));
    void writer.close();
    const buf = await new Response(stream.readable).arrayBuffer();
    return Array.from(new Uint8Array(buf));
  }
  async function compressIfSmaller(bytes2) {
    if (bytes2.length < MIN_COMPRESS || typeof CompressionStream === "undefined") return { bytes: bytes2, compressed: false };
    const z = await run(bytes2, new CompressionStream("gzip"));
    return z.length < bytes2.length ? { bytes: z, compressed: true } : { bytes: bytes2, compressed: false };
  }
  async function decompress(bytes2) {
    return run(bytes2, new DecompressionStream("gzip"));
  }

  // src/sellerNote.ts
  var MAX_NOTE_BYTES = 280;
  var MAX_HISTORY_SCAN = 30;
  function utf8Len(s2) {
    return new TextEncoder().encode(s2).length;
  }
  async function publishSellerNote(provider2, key2, collectionId, note) {
    const trimmed = note.text.trim();
    const bonusValue = note.bonusValue?.trim();
    if (trimmed.length === 0 && !bonusValue) throw new Error("note is empty");
    if (utf8Len(trimmed) > MAX_NOTE_BYTES) throw new Error(`note exceeds ${MAX_NOTE_BYTES} bytes`);
    if (bonusValue && utf8Len(bonusValue) > MAX_NOTE_BYTES) throw new Error(`bonus exceeds ${MAX_NOTE_BYTES} bytes`);
    const authorPub = key2.toPublicKey().toString();
    const selected = selectFunding(await getSafeUtxos(provider2), PHARLAP_OUTPUT_SATS + 500);
    const funding = await Promise.all(
      selected.map(async (u) => ({ utxo: u, sourceTx: await provider2.getSourceTransaction(u.txId) }))
    );
    const tx = new Transaction();
    for (const f2 of funding) {
      tx.addInput({
        sourceTransaction: f2.sourceTx,
        sourceOutputIndex: f2.utxo.outputIndex,
        unlockingScriptTemplate: new P2PKH().unlock(key2)
      });
    }
    tx.addOutput({
      lockingScript: buildNoteScript(authorPub, {
        collectionRef: collectionId,
        text: trimmed,
        ...bonusValue ? { bonusKind: note.bonusKind, bonusValue } : {}
      }),
      satoshis: PHARLAP_OUTPUT_SATS
    });
    tx.addOutput({ lockingScript: new P2PKH().lock(key2.toAddress()), change: true });
    await tx.fee(new SatoshisPerKilobyte(DEFAULT_FEE_PER_KB));
    await tx.sign();
    await provider2.broadcast(tx.toHex());
    const txId = tx.id("hex");
    provider2.registerPendingTx(
      txId,
      selected.map((u) => ({ txId: u.txId, outputIndex: u.outputIndex })),
      (tx.outputs[1]?.satoshis ?? 0) > 0 ? { outputIndex: 1, satoshis: tx.outputs[1].satoshis ?? 0 } : void 0
    );
    return txId;
  }
  function readNoteFromTx(tx, collectionId) {
    const want = collectionId.toLowerCase();
    for (const o of tx.outputs) {
      const n = parseNoteScript(o.lockingScript);
      if (n && n.fields.collectionRef.toLowerCase() === want) {
        return { text: n.fields.text, bonusKind: n.fields.bonusKind, bonusValue: n.fields.bonusValue };
      }
    }
    return null;
  }
  async function resolveSellerNote(provider2, sellerPubKeyHex, collectionId) {
    const sellerAddress = PublicKey.fromString(sellerPubKeyHex).toAddress();
    const heightByTx = /* @__PURE__ */ new Map();
    try {
      for (const h of await provider2.getAddressHistory(sellerAddress)) heightByTx.set(h.txId, h.blockHeight || 0);
    } catch {
    }
    try {
      for (const txId of await provider2.getRecentTxIdsForAddress(sellerAddress)) {
        if (!heightByTx.has(txId)) heightByTx.set(txId, 0);
      }
    } catch {
    }
    if (heightByTx.size === 0) return null;
    const ordered = [...heightByTx.entries()].sort((a, b) => (b[1] || 1e12) - (a[1] || 1e12)).slice(0, MAX_HISTORY_SCAN).map(([txId]) => txId);
    const seller = sellerPubKeyHex.toLowerCase();
    const want = collectionId.toLowerCase();
    for (const txId of ordered) {
      let tx;
      try {
        tx = await provider2.getSourceTransaction(txId);
      } catch {
        continue;
      }
      for (const o of tx.outputs) {
        const n = parseNoteScript(o.lockingScript);
        if (n && n.authorPubKeyHex.toLowerCase() === seller && n.fields.collectionRef.toLowerCase() === want) {
          return { text: n.fields.text, bonusKind: n.fields.bonusKind, bonusValue: n.fields.bonusValue, txId };
        }
      }
    }
    return null;
  }

  // src/contentCrypto.ts
  var OBFUSCATION_SALT = utils_exports.toArray("PHARLAP/tier1/content-key/v1", "utf8");
  function newContentKey() {
    return Random_default(32);
  }
  function newKeySalt() {
    return Random_default(16);
  }
  function encryptContent(fileBytes, K2) {
    return new SymmetricKey(K2).encrypt(fileBytes);
  }
  function decryptContent(ciphertext, K2) {
    return new SymmetricKey(K2).decrypt(ciphertext);
  }
  function obfuscationKey(keySalt) {
    return Hash_exports.sha256([...OBFUSCATION_SALT, ...keySalt]);
  }
  function wrapContentKey(K2, keySalt) {
    return new SymmetricKey(obfuscationKey(keySalt)).encrypt(K2);
  }
  function unwrapContentKey(wrappedK, keySalt) {
    try {
      return new SymmetricKey(obfuscationKey(keySalt)).decrypt(wrappedK);
    } catch {
      return null;
    }
  }

  // src/editionBuilder.ts
  function pubKeyBytes(key2) {
    return key2.toPublicKey().encode(true);
  }
  async function buildEditionGenesisTx(opts) {
    const tokenSats = opts.terms.tokenSats ?? PHARLAP_OUTPUT_SATS;
    const ownerPub = opts.ownerPubKey ?? pubKeyBytes(opts.key);
    const tx1Ref = utils_exports.toArray(opts.tx1Ref, "hex");
    if (tx1Ref.length !== 32) throw new Error("buildEditionGenesisTx: tx1Ref must be a 32-byte txid hex");
    const tx = new Transaction();
    tx.version = 2;
    for (const f2 of opts.funding) {
      tx.addInput({
        sourceTransaction: f2.sourceTx,
        sourceOutputIndex: f2.utxo.outputIndex,
        unlockingScriptTemplate: new P2PKH().unlock(opts.key)
      });
    }
    const editionVouts = [];
    for (let i = 0; i < (opts.mintCount ?? 1); i++) {
      const lock2 = buildEditionLock({
        tx1Ref,
        ownerPubKey: ownerPub,
        stateData: opts.stateData ?? [],
        publisherPubKeyHash: opts.terms.publisherPubKeyHash,
        publisherFeeSats: opts.terms.publisherFeeSats,
        holderFeeSats: opts.terms.holderFeeSats,
        tokenSats
      });
      editionVouts.push(tx.outputs.length);
      tx.addOutput({ lockingScript: lock2, satoshis: tokenSats });
    }
    const changeVout = tx.outputs.length;
    tx.addOutput({ lockingScript: new P2PKH().lock(opts.key.toAddress()), change: true });
    await tx.fee(new SatoshisPerKilobyte(opts.feePerKb ?? DEFAULT_FEE_PER_KB));
    await tx.sign();
    const changeSats = tx.outputs[changeVout]?.satoshis ?? 0;
    return { tx, txId: tx.id("hex"), editionVouts, changeVout: changeSats > 0 ? changeVout : null, changeSats };
  }
  var REPLICATE_UNLOCK_LEN = 1100;
  var TRANSFER_UNLOCK_LEN = 1200;
  function otherInputsOf(tx, inputIndex) {
    return tx.inputs.filter((_, i) => i !== inputIndex);
  }
  function replicateUnlockTemplate(opts) {
    return {
      sign: async (tx, inputIndex) => {
        const input = tx.inputs[inputIndex];
        const sourceTXID = input.sourceTXID ?? input.sourceTransaction?.id("hex");
        if (sourceTXID == null) throw new Error("replicate unlock: input is missing sourceTXID/sourceTransaction");
        const preimage = TransactionSignature.format({
          sourceTXID,
          sourceOutputIndex: input.sourceOutputIndex,
          sourceSatoshis: opts.sourceSatoshis,
          transactionVersion: tx.version,
          otherInputs: otherInputsOf(tx, inputIndex),
          inputIndex,
          outputs: tx.outputs,
          inputSequence: input.sequence ?? 4294967295,
          subscript: opts.lockingScript,
          lockTime: tx.lockTime,
          scope: EDITION_SCOPE
        });
        const enforced = opts.enforcedOutputCount ?? 4;
        const buyerChange = tx.outputs.slice(enforced).flatMap((o) => serializeOutput(o.satoshis ?? 0, o.lockingScript.toBinary()));
        return new UnlockingScript(editionReplicateUnlockChunks({ buyerPubKey: opts.buyerPubKey, buyerChange, preimage }));
      },
      estimateLength: async () => REPLICATE_UNLOCK_LEN
    };
  }
  function transferUnlockTemplate(opts) {
    return {
      sign: async (tx, inputIndex) => {
        const input = tx.inputs[inputIndex];
        const sourceTXID = input.sourceTXID ?? input.sourceTransaction?.id("hex");
        if (sourceTXID == null) throw new Error("transfer unlock: input is missing sourceTXID/sourceTransaction");
        const fmt = (scope) => TransactionSignature.format({
          sourceTXID,
          sourceOutputIndex: input.sourceOutputIndex,
          sourceSatoshis: opts.sourceSatoshis,
          transactionVersion: tx.version,
          otherInputs: otherInputsOf(tx, inputIndex),
          inputIndex,
          outputs: tx.outputs,
          inputSequence: input.sequence ?? 4294967295,
          subscript: opts.lockingScript,
          lockTime: tx.lockTime,
          scope
        });
        const introspection = fmt(EDITION_SCOPE);
        const ownerScope = TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID;
        const raw = opts.ownerKey.sign(Hash_exports.sha256(fmt(ownerScope)));
        const ownerSig = new TransactionSignature(raw.r, raw.s, ownerScope).toChecksigFormat();
        const enforced = opts.enforcedOutputCount ?? 1;
        const change = tx.outputs.slice(enforced).flatMap((o) => serializeOutput(o.satoshis ?? 0, o.lockingScript.toBinary()));
        return new UnlockingScript(editionTransferUnlockChunks({
          newOwnerPubKey: opts.newOwnerPubKey,
          ownerSig,
          change,
          preimage: introspection
        }));
      },
      estimateLength: async () => TRANSFER_UNLOCK_LEN
    };
  }
  function burnUnlockTemplate(opts) {
    return {
      sign: async (tx, inputIndex) => {
        const input = tx.inputs[inputIndex];
        const sourceTXID = input.sourceTXID ?? input.sourceTransaction?.id("hex");
        if (sourceTXID == null) throw new Error("burn unlock: input is missing sourceTXID/sourceTransaction");
        const fmt = (scope) => TransactionSignature.format({
          sourceTXID,
          sourceOutputIndex: input.sourceOutputIndex,
          sourceSatoshis: opts.sourceSatoshis,
          transactionVersion: tx.version,
          otherInputs: otherInputsOf(tx, inputIndex),
          inputIndex,
          outputs: tx.outputs,
          inputSequence: input.sequence ?? 4294967295,
          subscript: opts.lockingScript,
          lockTime: tx.lockTime,
          scope
        });
        const introspection = fmt(EDITION_SCOPE);
        const ownerScope = TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID;
        const raw = opts.ownerKey.sign(Hash_exports.sha256(fmt(ownerScope)));
        const ownerSig = new TransactionSignature(raw.r, raw.s, ownerScope).toChecksigFormat();
        return new UnlockingScript(editionBurnUnlockChunks({ ownerSig, preimage: introspection }));
      },
      estimateLength: async () => TRANSFER_UNLOCK_LEN
      // ~transfer minus the new-owner bytes
    };
  }
  async function buildReplicateTx(opts) {
    const bond = opts.edition.satoshis;
    const lock2 = LockingScript.fromBinary(opts.edition.lockBytes);
    const holderPub = editionOwnerPubKey(opts.edition.lockBytes);
    const buyerPub = opts.ownerPubKey ?? pubKeyBytes(opts.buyerKey);
    const tx1RefHex = parseEditionScript(lock2)?.tx1RefHex;
    const tx = new Transaction();
    tx.version = 2;
    tx.addInput({
      sourceTransaction: opts.edition.sourceTx,
      sourceOutputIndex: opts.edition.outputIndex,
      sequence: 4294967295,
      unlockingScriptTemplate: replicateUnlockTemplate({ buyerPubKey: buyerPub, lockingScript: lock2, sourceSatoshis: opts.edition.satoshis })
    });
    for (const f2 of opts.funding) {
      tx.addInput({
        sourceTransaction: f2.sourceTx,
        sourceOutputIndex: f2.utxo.outputIndex,
        unlockingScriptTemplate: new P2PKH().unlock(opts.buyerKey)
      });
    }
    tx.addOutput({ lockingScript: lock2, satoshis: bond });
    tx.addOutput({ lockingScript: LockingScript.fromBinary(swapEditionOwner(opts.edition.lockBytes, buyerPub)), satoshis: bond });
    tx.addOutput({ lockingScript: LockingScript.fromBinary(p2pkhScript(opts.terms.publisherPubKeyHash)), satoshis: opts.terms.publisherFeeSats });
    tx.addOutput({ lockingScript: LockingScript.fromBinary(p2pkhScript(Hash_exports.hash160(holderPub))), satoshis: opts.terms.holderFeeSats });
    if (opts.note && tx1RefHex != null && (opts.note.text.length > 0 || (opts.note.bonusValue?.length ?? 0) > 0)) {
      tx.addOutput({
        lockingScript: buildNoteScript(utils_exports.toHex(buyerPub), {
          collectionRef: tx1RefHex,
          text: opts.note.text,
          bonusKind: opts.note.bonusKind,
          bonusValue: opts.note.bonusValue
        }),
        satoshis: PHARLAP_OUTPUT_SATS
      });
    }
    const changeVout = tx.outputs.length;
    tx.addOutput({ lockingScript: new P2PKH().lock(opts.changeAddress ?? opts.buyerKey.toAddress()), change: true });
    await tx.fee(new SatoshisPerKilobyte(opts.feePerKb ?? DEFAULT_FEE_PER_KB));
    await tx.sign();
    const changeSats = tx.outputs[changeVout]?.satoshis ?? 0;
    return { tx, txId: tx.id("hex"), holderTokenVout: 0, replicaVout: 1, changeVout: changeSats > 0 ? changeVout : null };
  }
  async function buildReplicateV2Tx(opts) {
    const tokenSats = opts.tokenSats ?? PHARLAP_OUTPUT_SATS;
    const lock2 = LockingScript.fromBinary(opts.edition.lockBytes);
    const parsed = parseEditionScriptV2(lock2);
    if (parsed == null) throw new Error("buildReplicateV2Tx: not a v2 edition covenant");
    const holderPub = editionOwnerPubKey(opts.edition.lockBytes);
    const buyerPub = opts.ownerPubKey ?? pubKeyBytes(opts.buyerKey);
    const publisherCut = Math.floor(parsed.priceSats * parsed.terms.pBps / 1e4);
    const resellerCut = parsed.priceSats - publisherCut;
    const tx = new Transaction();
    tx.version = 2;
    tx.addInput({
      sourceTransaction: opts.edition.sourceTx,
      sourceOutputIndex: opts.edition.outputIndex,
      sequence: 4294967295,
      unlockingScriptTemplate: replicateUnlockTemplate({ buyerPubKey: buyerPub, lockingScript: lock2, sourceSatoshis: opts.edition.satoshis })
    });
    for (const f2 of opts.funding) {
      tx.addInput({
        sourceTransaction: f2.sourceTx,
        sourceOutputIndex: f2.utxo.outputIndex,
        unlockingScriptTemplate: new P2PKH().unlock(opts.buyerKey)
      });
    }
    tx.addOutput({ lockingScript: lock2, satoshis: tokenSats });
    tx.addOutput({ lockingScript: LockingScript.fromBinary(swapEditionOwner(opts.edition.lockBytes, buyerPub)), satoshis: tokenSats });
    tx.addOutput({ lockingScript: LockingScript.fromBinary(p2pkhScript(parsed.terms.publisherPubKeyHash)), satoshis: publisherCut });
    tx.addOutput({ lockingScript: LockingScript.fromBinary(p2pkhScript(Hash_exports.hash160(holderPub))), satoshis: resellerCut });
    if (opts.note && (opts.note.text.length > 0 || (opts.note.bonusValue?.length ?? 0) > 0)) {
      tx.addOutput({
        lockingScript: buildNoteScript(utils_exports.toHex(buyerPub), {
          collectionRef: parsed.tx1RefHex,
          text: opts.note.text,
          bonusKind: opts.note.bonusKind,
          bonusValue: opts.note.bonusValue
        }),
        satoshis: tokenSats
      });
    }
    const changeVout = tx.outputs.length;
    tx.addOutput({ lockingScript: new P2PKH().lock(opts.changeAddress ?? opts.buyerKey.toAddress()), change: true });
    await tx.fee(new SatoshisPerKilobyte(opts.feePerKb ?? DEFAULT_FEE_PER_KB));
    await tx.sign();
    const changeSats = tx.outputs[changeVout]?.satoshis ?? 0;
    return {
      tx,
      txId: tx.id("hex"),
      holderTokenVout: 0,
      replicaVout: 1,
      changeVout: changeSats > 0 ? changeVout : null,
      publisherCut,
      resellerCut
    };
  }
  async function buildEditionTransferTx(opts) {
    const bond = opts.edition.satoshis;
    const lock2 = LockingScript.fromBinary(opts.edition.lockBytes);
    const tx1RefHex = parseEditionScript(lock2)?.tx1RefHex;
    const tx = new Transaction();
    tx.version = 2;
    tx.addInput({
      sourceTransaction: opts.edition.sourceTx,
      sourceOutputIndex: opts.edition.outputIndex,
      sequence: 4294967295,
      unlockingScriptTemplate: transferUnlockTemplate({
        ownerKey: opts.ownerKey,
        newOwnerPubKey: opts.newOwnerPubKey,
        lockingScript: lock2,
        sourceSatoshis: opts.edition.satoshis
      })
    });
    for (const f2 of opts.funding) {
      tx.addInput({
        sourceTransaction: f2.sourceTx,
        sourceOutputIndex: f2.utxo.outputIndex,
        unlockingScriptTemplate: new P2PKH().unlock(opts.ownerKey)
      });
    }
    tx.addOutput({ lockingScript: LockingScript.fromBinary(swapEditionOwner(opts.edition.lockBytes, opts.newOwnerPubKey)), satoshis: bond });
    const notifyAddress = PublicKey.fromString(utils_exports.toHex(opts.newOwnerPubKey)).toAddress();
    tx.addOutput({ lockingScript: new P2PKH().lock(notifyAddress), satoshis: 1 });
    if (opts.note && tx1RefHex != null && (opts.note.text.length > 0 || (opts.note.bonusValue?.length ?? 0) > 0)) {
      tx.addOutput({
        lockingScript: buildNoteScript(utils_exports.toHex(opts.newOwnerPubKey), {
          collectionRef: tx1RefHex,
          text: opts.note.text,
          bonusKind: opts.note.bonusKind,
          bonusValue: opts.note.bonusValue
        }),
        satoshis: PHARLAP_OUTPUT_SATS
      });
    }
    const changeVout = tx.outputs.length;
    tx.addOutput({ lockingScript: new P2PKH().lock(opts.ownerKey.toAddress()), change: true });
    await tx.fee(new SatoshisPerKilobyte(opts.feePerKb ?? DEFAULT_FEE_PER_KB));
    await tx.sign();
    const changeSats = tx.outputs[changeVout]?.satoshis ?? 0;
    return { tx, txId: tx.id("hex"), tokenVout: 0, changeVout: changeSats > 0 ? changeVout : null };
  }
  async function toFundingInputs(provider2, utxos) {
    return Promise.all(utxos.map(async (u) => ({ utxo: u, sourceTx: await provider2.getSourceTransaction(u.txId) })));
  }
  async function createEdition(provider2, key2, params) {
    const feePerKb = params.feePerKb ?? DEFAULT_FEE_PER_KB;
    const mintCount = params.mintCount ?? 1;
    const ownerPub = params.ownerPubKey ?? pubKeyBytes(key2);
    const tokenSats = params.terms.tokenSats ?? PHARLAP_OUTPUT_SATS;
    const stateData = params.stateData ?? [];
    const templateLock = buildEditionLock({
      tx1Ref: new Array(32).fill(0),
      ownerPubKey: new Array(33).fill(0),
      stateData,
      publisherPubKeyHash: params.terms.publisherPubKeyHash,
      publisherFeeSats: params.terms.publisherFeeSats,
      holderFeeSats: params.terms.holderFeeSats,
      tokenSats
    });
    const encrypt = params.encrypt === true && params.file != null;
    let storedBytes = params.file?.bytes;
    let compressed = false;
    let wrappedKey;
    let keySalt;
    if (params.file != null) {
      const z = await compressIfSmaller(params.file.bytes);
      storedBytes = z.bytes;
      compressed = z.compressed;
      if (encrypt) {
        const K2 = newContentKey();
        keySalt = newKeySalt();
        storedBytes = encryptContent(storedBytes, K2);
        wrappedKey = wrapContentKey(K2, keySalt);
      }
    }
    const restrictions = RESTRICTION_REPLICABLE | (encrypt ? RESTRICTION_ENCRYPTED : 0) | (compressed ? RESTRICTION_COMPRESSED : 0);
    const template = {
      tokenName: params.tokenName,
      tokenRules: encodeTokenRules(0, 0, restrictions, 1),
      // supply 0 = unlimited / replicable
      covenantScript: utils_exports.toHex(templateLock.toBinary()),
      // fileHash semantics: PUBLIC content binds the ORIGINAL plaintext (provenance — a verifier decompresses
      // the on-chain blob and matches H(plaintext); DEFLATE decompression is deterministic so the proof is
      // independent of the non-reproducible gzip encoding). ENCRYPTED content binds the ciphertext (privacy —
      // a public plaintext hash would be a confirmation oracle).
      fileHash: params.file == null ? void 0 : encrypt ? sha256Hex(storedBytes) : sha256Hex(params.file.bytes),
      wrappedKey,
      keySalt
    };
    const file = params.file != null ? { mimeType: params.file.mimeType, fileName: params.file.fileName, fileBytes: storedBytes } : void 0;
    const hasStorefront = params.description != null && params.description.length > 0 || params.cover != null;
    const storefront = hasStorefront ? {
      description: params.description ?? "",
      coverMimeType: params.cover?.mimeType,
      coverFileName: params.cover?.fileName,
      coverBytes: params.cover?.bytes
    } : void 0;
    const editionBytes = 800;
    const tx1Bytes = 500 + templateLock.toBinary().length + (file ? file.fileBytes.length : 0) + (params.cover ? params.cover.bytes.length : 0);
    const tx2Bytes = 300 + mintCount * editionBytes;
    const estFee = Math.ceil((tx1Bytes + tx2Bytes) * feePerKb / 1e3);
    const target = (1 + mintCount) * tokenSats + estFee + Math.max(1e3, Math.ceil(estFee * 0.2));
    const selected = selectFunding(await getSafeUtxos(provider2), target);
    const funding = await toFundingInputs(provider2, selected);
    const t1 = await buildTemplateTx({ key: key2, funding, template, file, storefront, outputSats: tokenSats, feePerKb });
    if (t1.changeVout == null) throw new Error("Insufficient funding: template tx left no change to fund the edition mint.");
    const t2Funding = [{
      utxo: { txId: t1.tx1Id, outputIndex: t1.changeVout, satoshis: t1.changeSats, script: "" },
      sourceTx: t1.tx
    }];
    const t2 = await buildEditionGenesisTx({
      key: key2,
      funding: t2Funding,
      tx1Ref: t1.tx1Id,
      terms: params.terms,
      ownerPubKey: ownerPub,
      stateData,
      mintCount,
      feePerKb
    });
    if (params.confirmSpend != null && !await params.confirmSpend(spentSats(selected, t2.changeSats))) {
      throw new Error(SPEND_CANCELLED);
    }
    await provider2.broadcast(t1.tx.toHex());
    provider2.registerPendingTx(
      t1.tx1Id,
      selected.map((u) => ({ txId: u.txId, outputIndex: u.outputIndex })),
      { outputIndex: t1.changeVout, satoshis: t1.changeSats }
    );
    await provider2.broadcast(t2.tx.toHex());
    provider2.registerPendingTx(
      t2.txId,
      [{ txId: t1.tx1Id, outputIndex: t1.changeVout }],
      t2.changeVout != null ? { outputIndex: t2.changeVout, satoshis: t2.changeSats } : void 0
    );
    const editions = t2.editionVouts.map((v) => ({
      txId: t2.txId,
      outputIndex: v,
      lockHex: utils_exports.toHex(t2.tx.outputs[v].lockingScript.toBinary())
    }));
    return { collectionId: t1.tx1Id, tx1Id: t1.tx1Id, tx2Id: t2.txId, editions };
  }
  async function replicateEdition(provider2, buyerKey, params) {
    const feePerKb = params.feePerKb ?? DEFAULT_FEE_PER_KB;
    const lockBytes = utils_exports.toArray(params.editionLockHex, "hex");
    const sourceTx = await provider2.getSourceTransaction(params.editionTxId);
    const bond = sourceTx.outputs[params.editionOutputIndex]?.satoshis ?? PHARLAP_OUTPUT_SATS;
    const edition = {
      txId: params.editionTxId,
      outputIndex: params.editionOutputIndex,
      satoshis: bond,
      lockBytes,
      sourceTx
    };
    const noteSats = params.note ? PHARLAP_OUTPUT_SATS : 0;
    const estFee = Math.ceil(1500 * feePerKb / 1e3);
    const target = 2 * bond + noteSats + params.terms.publisherFeeSats + params.terms.holderFeeSats + estFee + 1e3;
    const selected = selectFunding(await getSafeUtxos(provider2), target);
    const funding = await toFundingInputs(provider2, selected);
    const rep = await buildReplicateTx({ edition, terms: params.terms, buyerKey, funding, note: params.note, feePerKb });
    const repChange = rep.changeVout != null ? rep.tx.outputs[rep.changeVout]?.satoshis ?? 0 : 0;
    if (params.confirmSpend != null && !await params.confirmSpend(spentSats(selected, repChange))) {
      throw new Error(SPEND_CANCELLED);
    }
    await provider2.broadcast(rep.tx.toHex());
    provider2.registerPendingTx(
      rep.txId,
      [
        { txId: params.editionTxId, outputIndex: params.editionOutputIndex },
        ...selected.map((u) => ({ txId: u.txId, outputIndex: u.outputIndex }))
      ],
      rep.changeVout != null ? { outputIndex: rep.changeVout, satoshis: rep.tx.outputs[rep.changeVout].satoshis ?? 0 } : void 0
    );
    return {
      txId: rep.txId,
      replicaOutpoint: { txId: rep.txId, outputIndex: rep.replicaVout },
      lockHex: utils_exports.toHex(rep.tx.outputs[rep.replicaVout].lockingScript.toBinary())
    };
  }
  async function replicateEditionV2(provider2, buyerKey, params) {
    const feePerKb = params.feePerKb ?? DEFAULT_FEE_PER_KB;
    const lockBytes = utils_exports.toArray(params.editionLockHex, "hex");
    const parsed = parseEditionScriptV2(LockingScript.fromBinary(lockBytes));
    if (parsed == null) throw new Error("replicateEditionV2: not a v2 edition covenant");
    const sourceTx = params.editionSourceTx ?? await provider2.getSourceTransaction(params.editionTxId);
    const tokenSats = sourceTx.outputs[params.editionOutputIndex]?.satoshis ?? PHARLAP_OUTPUT_SATS;
    const edition = {
      txId: params.editionTxId,
      outputIndex: params.editionOutputIndex,
      satoshis: tokenSats,
      lockBytes,
      sourceTx
    };
    const noteSats = params.note ? tokenSats : 0;
    const estFee = Math.ceil(1600 * feePerKb / 1e3);
    const target = 2 * tokenSats + noteSats + parsed.priceSats + estFee + 1e3;
    const selected = selectFunding(await getSafeUtxos(provider2), target);
    const funding = await toFundingInputs(provider2, selected);
    const rep = await buildReplicateV2Tx({ edition, buyerKey, funding, note: params.note, feePerKb });
    const repChange = rep.changeVout != null ? rep.tx.outputs[rep.changeVout]?.satoshis ?? 0 : 0;
    if (params.confirmSpend != null && !await params.confirmSpend(spentSats(selected, repChange))) {
      throw new Error(SPEND_CANCELLED);
    }
    await provider2.broadcast(rep.tx.toHex());
    provider2.registerPendingTx(
      rep.txId,
      [
        { txId: params.editionTxId, outputIndex: params.editionOutputIndex },
        ...selected.map((u) => ({ txId: u.txId, outputIndex: u.outputIndex }))
      ],
      rep.changeVout != null ? { outputIndex: rep.changeVout, satoshis: rep.tx.outputs[rep.changeVout].satoshis ?? 0 } : void 0
    );
    return {
      txId: rep.txId,
      replicaOutpoint: { txId: rep.txId, outputIndex: rep.replicaVout },
      lockHex: utils_exports.toHex(rep.tx.outputs[rep.replicaVout].lockingScript.toBinary()),
      publisherCut: rep.publisherCut,
      resellerCut: rep.resellerCut
    };
  }
  async function createGiftVouchers(provider2, publisherKey, params) {
    const feePerKb = params.feePerKb ?? DEFAULT_FEE_PER_KB;
    const count = Math.max(1, Math.floor(params.count));
    const keys = Array.from({ length: count }, () => PrivateKey.fromRandom());
    const estFee = Math.ceil((250 + count * 35) * feePerKb / 1e3);
    const target = count * params.fundEachSats + estFee + 500;
    const selected = selectFunding(await getSafeUtxos(provider2), target);
    if (selected.length === 0) throw new Error("Insufficient funds to create the gift vouchers.");
    const funding = await toFundingInputs(provider2, selected);
    const tx = new Transaction();
    for (const f2 of funding) {
      tx.addInput({ sourceTransaction: f2.sourceTx, sourceOutputIndex: f2.utxo.outputIndex, unlockingScriptTemplate: new P2PKH().unlock(publisherKey) });
    }
    for (const k of keys) {
      tx.addOutput({ lockingScript: new P2PKH().lock(k.toAddress()), satoshis: params.fundEachSats });
    }
    const changeVout = tx.outputs.length;
    tx.addOutput({ lockingScript: new P2PKH().lock(publisherKey.toAddress()), change: true });
    await tx.fee(new SatoshisPerKilobyte(feePerKb));
    await tx.sign();
    await provider2.broadcast(tx.toHex());
    const txId = tx.id("hex");
    provider2.registerPendingTx(
      txId,
      selected.map((u) => ({ txId: u.txId, outputIndex: u.outputIndex })),
      (tx.outputs[changeVout]?.satoshis ?? 0) > 0 ? { outputIndex: changeVout, satoshis: tx.outputs[changeVout].satoshis ?? 0 } : void 0
    );
    return { fundingTxId: txId, voucherWifs: keys.map((k) => k.toWif()) };
  }
  async function claimGiftEdition(provider2, ownerKey, params) {
    const giftKey = PrivateKey.fromWif(params.giftWif);
    const giftScript = p2pkhScript(Hash_exports.hash160(giftKey.toPublicKey().encode(true)));
    const giftUtxos = await provider2.getUnspentByScriptHash(wocScriptHash(giftScript));
    if (giftUtxos.length === 0) throw new Error("This free copy has already been claimed.");
    const funding = await toFundingInputs(provider2, giftUtxos);
    const lockBytes = utils_exports.toArray(params.editionLockHex, "hex");
    const parsed = parseEditionAny(LockingScript.fromBinary(lockBytes));
    if (parsed == null) throw new Error("claimGiftEdition: not an edition covenant");
    const sourceTx = params.editionSourceTx ?? await provider2.getSourceTransaction(params.editionTxId);
    const tokenSats = sourceTx.outputs[params.editionOutputIndex]?.satoshis ?? PHARLAP_OUTPUT_SATS;
    const edition = { txId: params.editionTxId, outputIndex: params.editionOutputIndex, satoshis: tokenSats, lockBytes, sourceTx };
    const ownerPub = ownerKey.toPublicKey().encode(true);
    const changeAddress = ownerKey.toAddress();
    let rep;
    if (parsed.isV2) {
      rep = await buildReplicateV2Tx({ edition, buyerKey: giftKey, funding, ownerPubKey: ownerPub, changeAddress, note: params.note, feePerKb: params.feePerKb });
    } else {
      const terms = {
        publisherPubKeyHash: parsed.terms.publisherPubKeyHash,
        publisherFeeSats: parsed.terms.publisherFeeSats,
        holderFeeSats: parsed.terms.holderFeeSats,
        tokenSats
      };
      rep = await buildReplicateTx({ edition, terms, buyerKey: giftKey, funding, ownerPubKey: ownerPub, changeAddress, note: params.note, feePerKb: params.feePerKb });
    }
    await provider2.broadcast(rep.tx.toHex());
    provider2.registerPendingTx(
      rep.txId,
      [{ txId: params.editionTxId, outputIndex: params.editionOutputIndex }, ...giftUtxos.map((u) => ({ txId: u.txId, outputIndex: u.outputIndex }))],
      rep.changeVout != null ? { outputIndex: rep.changeVout, satoshis: rep.tx.outputs[rep.changeVout].satoshis ?? 0 } : void 0
    );
    return {
      txId: rep.txId,
      replicaOutpoint: { txId: rep.txId, outputIndex: rep.replicaVout },
      lockHex: utils_exports.toHex(rep.tx.outputs[rep.replicaVout].lockingScript.toBinary()),
      isV2: parsed.isV2
    };
  }
  async function transferEdition(provider2, ownerKey, params) {
    const feePerKb = params.feePerKb ?? DEFAULT_FEE_PER_KB;
    const lockBytes = utils_exports.toArray(params.editionLockHex, "hex");
    const sourceTx = await provider2.getSourceTransaction(params.editionTxId);
    const bond = sourceTx.outputs[params.editionOutputIndex]?.satoshis ?? PHARLAP_OUTPUT_SATS;
    const edition = {
      txId: params.editionTxId,
      outputIndex: params.editionOutputIndex,
      satoshis: bond,
      lockBytes,
      sourceTx
    };
    const noteSats = params.note ? PHARLAP_OUTPUT_SATS : 0;
    const estFee = Math.ceil(1500 * feePerKb / 1e3);
    const selected = selectFunding(await getSafeUtxos(provider2), noteSats + estFee + 1e3);
    const funding = await toFundingInputs(provider2, selected);
    const xfer = await buildEditionTransferTx({
      edition,
      ownerKey,
      newOwnerPubKey: params.newOwnerPubKey,
      funding,
      note: params.note,
      feePerKb
    });
    await provider2.broadcast(xfer.tx.toHex());
    provider2.registerPendingTx(
      xfer.txId,
      [
        { txId: params.editionTxId, outputIndex: params.editionOutputIndex },
        ...selected.map((u) => ({ txId: u.txId, outputIndex: u.outputIndex }))
      ],
      xfer.changeVout != null ? { outputIndex: xfer.changeVout, satoshis: xfer.tx.outputs[xfer.changeVout].satoshis ?? 0 } : void 0
    );
    return {
      txId: xfer.txId,
      tokenOutpoint: { txId: xfer.txId, outputIndex: xfer.tokenVout },
      lockHex: utils_exports.toHex(xfer.tx.outputs[xfer.tokenVout].lockingScript.toBinary())
    };
  }
  async function buildEditionBurnTx(opts) {
    const lock2 = LockingScript.fromBinary(opts.edition.lockBytes);
    const reclaimAddress = opts.reclaimAddress ?? opts.ownerKey.toAddress();
    const tx = new Transaction();
    tx.version = 2;
    tx.addInput({
      sourceTransaction: opts.edition.sourceTx,
      sourceOutputIndex: opts.edition.outputIndex,
      sequence: 4294967295,
      unlockingScriptTemplate: burnUnlockTemplate({ ownerKey: opts.ownerKey, lockingScript: lock2, sourceSatoshis: opts.edition.satoshis })
    });
    tx.addOutput({ lockingScript: new P2PKH().lock(reclaimAddress), change: true });
    await tx.fee(new SatoshisPerKilobyte(opts.feePerKb ?? DEFAULT_FEE_PER_KB));
    await tx.sign();
    return { tx, txId: tx.id("hex"), reclaimVout: 0, reclaimSats: tx.outputs[0]?.satoshis ?? 0 };
  }
  async function burnEdition(provider2, ownerKey, params) {
    const lockBytes = utils_exports.toArray(params.editionLockHex, "hex");
    const sourceTx = await provider2.getSourceTransaction(params.editionTxId);
    const satoshis = sourceTx.outputs[params.editionOutputIndex]?.satoshis ?? 0;
    const edition = { txId: params.editionTxId, outputIndex: params.editionOutputIndex, satoshis, lockBytes, sourceTx };
    const r2 = await buildEditionBurnTx({ edition, ownerKey, feePerKb: params.feePerKb });
    await provider2.broadcast(r2.tx.toHex());
    provider2.registerPendingTx(
      r2.txId,
      [{ txId: params.editionTxId, outputIndex: params.editionOutputIndex }],
      r2.reclaimSats > 0 ? { outputIndex: r2.reclaimVout, satoshis: r2.reclaimSats } : void 0
    );
    return { txId: r2.txId, reclaimSats: r2.reclaimSats };
  }
  async function broadcastV2Probe(provider2, key2, feePerKb) {
    const selected = selectFunding(await getSafeUtxos(provider2), 1e3);
    const funding = await toFundingInputs(provider2, selected);
    const tx = new Transaction();
    tx.version = 2;
    for (const f2 of funding) {
      tx.addInput({ sourceTransaction: f2.sourceTx, sourceOutputIndex: f2.utxo.outputIndex, unlockingScriptTemplate: new P2PKH().unlock(key2) });
    }
    tx.addOutput({ lockingScript: new P2PKH().lock(key2.toAddress()), change: true });
    await tx.fee(new SatoshisPerKilobyte(feePerKb ?? DEFAULT_FEE_PER_KB));
    await tx.sign();
    await provider2.broadcast(tx.toHex());
    provider2.registerPendingTx(
      tx.id("hex"),
      selected.map((u) => ({ txId: u.txId, outputIndex: u.outputIndex })),
      tx.outputs[0]?.satoshis != null ? { outputIndex: 0, satoshis: tx.outputs[0].satoshis } : void 0
    );
    return tx.id("hex");
  }
  function wocScriptHash(scriptBytes) {
    return utils_exports.toHex(Hash_exports.sha256(scriptBytes).reverse());
  }
  async function resolveHolderEdition(provider2, params) {
    const tx1Ref = utils_exports.toArray(params.tx1RefHex, "hex");
    const ownerPub = utils_exports.toArray(params.holderPubKeyHex, "hex");
    const templateBytes = utils_exports.toArray(params.templateCovenantHex, "hex");
    const lockBytes = buildHolderEditionScript(templateBytes, tx1Ref, ownerPub);
    const lockScript = LockingScript.fromHex(utils_exports.toHex(lockBytes));
    const ed = parseEditionAny(lockScript);
    if (ed == null) throw new Error("resolveHolderEdition: reconstructed script is not a valid edition");
    const unspent = await provider2.getUnspentByScriptHash(wocScriptHash(lockBytes));
    if (unspent.length === 0) return null;
    const pick = unspent.find((u) => u.satoshis > 0) ?? unspent[0];
    return {
      txId: pick.txId,
      outputIndex: pick.outputIndex,
      lockHex: utils_exports.toHex(lockBytes),
      terms: { publisherPubKeyHash: ed.terms.publisherPubKeyHash, publisherFeeSats: ed.terms.publisherFeeSats, holderFeeSats: ed.terms.holderFeeSats, tokenSats: pick.satoshis },
      tokenSats: pick.satoshis,
      isV2: ed.isV2,
      priceSats: ed.priceSats
    };
  }
  async function scanIncomingEditions(provider2, pubKeyHex2) {
    const mine = pubKeyHex2.toLowerCase();
    const candidateTxIds = /* @__PURE__ */ new Set();
    try {
      for (const { txId } of await provider2.getAddressHistory()) candidateTxIds.add(txId);
    } catch {
    }
    try {
      for (const u of await provider2.getUtxos()) candidateTxIds.add(u.txId);
    } catch {
    }
    const scripts = /* @__PURE__ */ new Map();
    for (const txId of candidateTxIds) {
      let tx;
      try {
        tx = await provider2.getSourceTransaction(txId);
      } catch {
        continue;
      }
      for (const o of tx.outputs) {
        const ed = parseEditionAny(o.lockingScript);
        if (ed == null || ed.ownerPubKeyHex.toLowerCase() !== mine) continue;
        scripts.set(utils_exports.toHex(o.lockingScript.toBinary()), ed.tx1RefHex);
      }
    }
    const found = [];
    const seen = /* @__PURE__ */ new Set();
    for (const [lockHex, tx1RefHex] of scripts) {
      const lockBytes = utils_exports.toArray(lockHex, "hex");
      let unspent;
      try {
        unspent = await provider2.getUnspentByScriptHash(wocScriptHash(lockBytes));
      } catch {
        continue;
      }
      const ed = parseEditionAny(LockingScript.fromHex(lockHex));
      if (ed == null) continue;
      for (const u of unspent) {
        const key2 = `${u.txId}:${u.outputIndex}`;
        if (seen.has(key2)) continue;
        seen.add(key2);
        let note = null;
        try {
          note = readNoteFromTx(await provider2.getSourceTransaction(u.txId), tx1RefHex);
        } catch {
        }
        found.push({
          txId: u.txId,
          outputIndex: u.outputIndex,
          lockHex,
          tx1RefHex,
          terms: { publisherPubKeyHash: ed.terms.publisherPubKeyHash, publisherFeeSats: ed.terms.publisherFeeSats, holderFeeSats: ed.terms.holderFeeSats, tokenSats: u.satoshis ?? PHARLAP_OUTPUT_SATS },
          isV2: ed.isV2,
          priceSats: ed.priceSats,
          ...note ? { sellerNote: note } : {},
          ...u.height ? { height: u.height } : {}
        });
      }
    }
    return found;
  }

  // src/transfer.ts
  async function buildTransferTx(opts) {
    const sats = opts.outputSats ?? PHARLAP_OUTPUT_SATS;
    const notify = opts.notify ?? true;
    const address2 = opts.key.toAddress();
    const tokenOut = opts.tokenSourceTx.outputs[opts.tokenOutputIndex];
    const parsed = tokenOut ? parseTokenScript(tokenOut.lockingScript) : null;
    if (!parsed) throw new Error("buildTransferTx: source output is not a PHAR LAP token");
    const tokenFields = {
      tx1Ref: parsed.fields.tx1Ref,
      stateData: opts.newStateData ?? parsed.fields.stateData
    };
    const tx = new Transaction();
    tx.addInput({
      sourceTransaction: opts.tokenSourceTx,
      sourceOutputIndex: opts.tokenOutputIndex,
      unlockingScriptTemplate: unlock(opts.key)
    });
    for (const f2 of opts.funding) {
      tx.addInput({
        sourceTransaction: f2.sourceTx,
        sourceOutputIndex: f2.utxo.outputIndex,
        unlockingScriptTemplate: new P2PKH().unlock(opts.key)
      });
    }
    tx.addOutput({ lockingScript: buildTokenScript(opts.recipientPubKeyHex, tokenFields), satoshis: sats });
    const recipientVout = 0;
    let notifyVout = null;
    if (notify) {
      const recipientAddress = PublicKey.fromString(opts.recipientPubKeyHex).toAddress();
      notifyVout = tx.outputs.length;
      tx.addOutput({ lockingScript: new P2PKH().lock(recipientAddress), satoshis: 1 });
    }
    let publisherNotifyVout = null;
    if (opts.notifyPublisher) {
      if (opts.publisherPubKeyHex == null) {
        throw new Error("buildTransferTx: notifyPublisher requires publisherPubKeyHex");
      }
      const publisherAddress = PublicKey.fromString(opts.publisherPubKeyHex).toAddress();
      publisherNotifyVout = tx.outputs.length;
      tx.addOutput({ lockingScript: new P2PKH().lock(publisherAddress), satoshis: 1 });
    }
    const changeVout = tx.outputs.length;
    tx.addOutput({ lockingScript: new P2PKH().lock(address2), change: true });
    await tx.fee(new SatoshisPerKilobyte(opts.feePerKb ?? DEFAULT_FEE_PER_KB));
    await tx.sign();
    const changeSats = tx.outputs[changeVout]?.satoshis ?? 0;
    return {
      tx,
      txId: tx.id("hex"),
      recipientVout,
      notifyVout,
      publisherNotifyVout,
      changeVout: changeSats > 0 ? changeVout : null,
      changeSats,
      tokenFields
    };
  }
  async function createTransfer(provider2, key2, opts) {
    const tokenSourceTx = await provider2.getSourceTransaction(opts.tokenTxId);
    const feeHeadroom = Math.ceil(500 * (opts.feePerKb ?? DEFAULT_FEE_PER_KB) / 1e3) + 200;
    const selected = selectFunding(await getSafeUtxos(provider2), feeHeadroom);
    const funding = await Promise.all(
      selected.map(async (u) => ({ utxo: u, sourceTx: await provider2.getSourceTransaction(u.txId) }))
    );
    const result = await buildTransferTx({
      key: key2,
      tokenOutputIndex: opts.tokenOutputIndex,
      tokenSourceTx,
      recipientPubKeyHex: opts.recipientPubKeyHex,
      funding,
      newStateData: opts.newStateData,
      notify: opts.notify,
      notifyPublisher: opts.notifyPublisher,
      publisherPubKeyHex: opts.publisherPubKeyHex,
      outputSats: opts.outputSats,
      feePerKb: opts.feePerKb
    });
    await provider2.broadcast(result.tx.toHex());
    provider2.registerPendingTx(
      result.txId,
      [
        { txId: opts.tokenTxId, outputIndex: opts.tokenOutputIndex },
        ...selected.map((u) => ({ txId: u.txId, outputIndex: u.outputIndex }))
      ],
      result.changeVout != null ? { outputIndex: result.changeVout, satoshis: result.changeSats } : void 0
    );
    return result;
  }
  function findOwnedTokenOutputs(tx, ownerPubKeyHex) {
    const found = [];
    tx.outputs.forEach((o, i) => {
      const parsed = parseTokenScript(o.lockingScript);
      if (parsed != null && parsed.ownerPubKeyHex === ownerPubKeyHex) {
        found.push({ outputIndex: i, fields: parsed.fields });
      }
    });
    return found;
  }
  async function scanIncoming(provider2, myPubKeyHex) {
    const candidateTxIds = /* @__PURE__ */ new Set();
    try {
      for (const { txId } of await provider2.getAddressHistory()) candidateTxIds.add(txId);
    } catch {
    }
    try {
      for (const u of await provider2.getUtxos()) candidateTxIds.add(u.txId);
    } catch {
    }
    const found = [];
    for (const txId of candidateTxIds) {
      let tx;
      try {
        tx = await provider2.getSourceTransaction(txId);
      } catch {
        continue;
      }
      for (const { outputIndex, fields } of findOwnedTokenOutputs(tx, myPubKeyHex)) {
        found.push({ txId, outputIndex, fields });
      }
    }
    return found;
  }

  // src/messageCodec.ts
  var ENVELOPE_VERSION = 1;
  var FLAG_ENCRYPTED = 1;
  var FLAG_COMPRESSED = 2;
  var PART_TEXT = 1;
  var PART_KEY = 2;
  var PART_FILE_INLINE = 3;
  var PART_FILE_REF = 4;
  var PART_ALIAS = 5;
  var PART_TIME = 6;
  function encodeTimeMs(ms) {
    const out = [];
    let v = Math.max(0, Math.floor(ms));
    for (let i = 0; i < 6; i++) {
      out.push(v & 255);
      v = Math.floor(v / 256);
    }
    return out;
  }
  function decodeTimeMs(b) {
    let n = 0;
    for (let i = b.length - 1; i >= 0; i--) n = n * 256 + b[i];
    return n;
  }
  function writeVarInt(n) {
    if (n < 253) return [n];
    if (n <= 65535) return [253, n & 255, n >> 8 & 255];
    if (n <= 4294967295) return [254, n & 255, n >> 8 & 255, n >> 16 & 255, n >> 24 & 255];
    throw new Error("writeVarInt: value too large");
  }
  function readVarInt(b, off) {
    const first = b[off];
    if (first < 253) return [first, off + 1];
    if (first === 253) return [b[off + 1] | b[off + 2] << 8, off + 3];
    if (first === 254) return [b[off + 1] | b[off + 2] << 8 | b[off + 3] << 16 | b[off + 4] << 24, off + 5];
    throw new Error("readVarInt: 64-bit lengths unsupported");
  }
  function lenPrefixed(bytes2) {
    return [...writeVarInt(bytes2.length), ...bytes2];
  }
  function encodePartValue(p) {
    switch (p.kind) {
      case "text":
        return { type: PART_TEXT, value: utils_exports.toArray(p.text, "utf8") };
      case "key":
        return { type: PART_KEY, value: [...p.key] };
      case "file":
        return {
          type: PART_FILE_INLINE,
          value: [...lenPrefixed(utils_exports.toArray(p.mimeType, "utf8")), ...lenPrefixed(utils_exports.toArray(p.fileName, "utf8")), ...p.bytes]
        };
      case "fileRef": {
        if (p.sha256.length !== 32) throw new Error("fileRef sha256 must be 32 bytes");
        return { type: PART_FILE_REF, value: [...p.sha256, ...utils_exports.toArray(p.uri, "utf8")] };
      }
      case "alias":
        return { type: PART_ALIAS, value: utils_exports.toArray(p.alias, "utf8") };
      case "time":
        return { type: PART_TIME, value: encodeTimeMs(p.ms) };
    }
  }
  function encodeParts(parts) {
    const out = [];
    for (const p of parts) {
      const { type, value } = encodePartValue(p);
      out.push(type, ...lenPrefixed(value));
    }
    return out;
  }
  function decodeParts(bytes2) {
    const parts = [];
    let off = 0;
    try {
      while (off < bytes2.length) {
        const type = bytes2[off++];
        let len;
        [len, off] = readVarInt(bytes2, off);
        const value = bytes2.slice(off, off + len);
        if (value.length !== len) return null;
        off += len;
        switch (type) {
          case PART_TEXT:
            parts.push({ kind: "text", text: utils_exports.toUTF8(value) });
            break;
          case PART_KEY:
            parts.push({ kind: "key", key: value });
            break;
          case PART_FILE_INLINE: {
            let o = 0, mlen = 0, nlen = 0;
            [mlen, o] = readVarInt(value, o);
            const mime = value.slice(o, o + mlen);
            o += mlen;
            [nlen, o] = readVarInt(value, o);
            const name = value.slice(o, o + nlen);
            o += nlen;
            parts.push({ kind: "file", mimeType: utils_exports.toUTF8(mime), fileName: utils_exports.toUTF8(name), bytes: value.slice(o) });
            break;
          }
          case PART_FILE_REF:
            parts.push({ kind: "fileRef", sha256: value.slice(0, 32), uri: utils_exports.toUTF8(value.slice(32)) });
            break;
          case PART_ALIAS:
            parts.push({ kind: "alias", alias: utils_exports.toUTF8(value) });
            break;
          case PART_TIME:
            parts.push({ kind: "time", ms: decodeTimeMs(value) });
            break;
          default:
            return null;
        }
      }
    } catch {
      return null;
    }
    return parts;
  }
  async function buildEnvelope(opts) {
    const encrypt = opts.encrypt ?? true;
    const senderPub = opts.senderPriv.toPublicKey().encode(true);
    if (senderPub.length !== 33) throw new Error("senderPub must be 33 bytes");
    const meta = [];
    if (opts.senderAlias != null && opts.senderAlias !== "") meta.push({ kind: "alias", alias: opts.senderAlias });
    if (opts.sentAt != null && opts.sentAt > 0) meta.push({ kind: "time", ms: opts.sentAt });
    const allParts = meta.length > 0 ? [...meta, ...opts.parts] : opts.parts;
    let payload = encodeParts(allParts);
    let flags = 0;
    const c = await compressIfSmaller(payload);
    if (c.compressed) {
      payload = c.bytes;
      flags |= FLAG_COMPRESSED;
    }
    const body = encrypt ? ECIES.electrumEncrypt(payload, PublicKey.fromString(opts.recipientPubKeyHex), opts.senderPriv, true) : payload;
    if (encrypt) flags |= FLAG_ENCRYPTED;
    return [ENVELOPE_VERSION, flags, ...senderPub, ...body];
  }
  function splitMeta(parts) {
    const aliasPart = parts.find((p) => p.kind === "alias");
    const timePart = parts.find((p) => p.kind === "time");
    return {
      senderAlias: aliasPart != null && aliasPart.kind === "alias" ? aliasPart.alias : void 0,
      sentAt: timePart != null && timePart.kind === "time" ? timePart.ms : void 0,
      parts: parts.filter((p) => p.kind !== "alias" && p.kind !== "time")
    };
  }
  async function openEnvelope(envelope, recipientPriv) {
    if (envelope.length < 35) return null;
    if (envelope[0] !== ENVELOPE_VERSION) return null;
    const encrypted = (envelope[1] & FLAG_ENCRYPTED) !== 0;
    const compressed = (envelope[1] & FLAG_COMPRESSED) !== 0;
    const senderPub = envelope.slice(2, 35);
    const senderPubKeyHex = utils_exports.toHex(senderPub);
    const body = envelope.slice(35);
    let tlv;
    if (encrypted) {
      try {
        tlv = ECIES.electrumDecrypt(body, recipientPriv, PublicKey.fromString(senderPubKeyHex));
      } catch {
        return null;
      }
    } else {
      tlv = body;
    }
    if (compressed) {
      try {
        tlv = await decompress(tlv);
      } catch {
        return null;
      }
    }
    const decoded = decodeParts(tlv);
    if (decoded == null) return null;
    const { senderAlias, sentAt, parts } = splitMeta(decoded);
    return { senderPubKeyHex, encrypted, parts, senderAlias, sentAt };
  }
  async function openPublicEnvelope(envelope) {
    if (envelope.length < 35 || envelope[0] !== ENVELOPE_VERSION) return null;
    if ((envelope[1] & FLAG_ENCRYPTED) !== 0) return null;
    const senderPubKeyHex = utils_exports.toHex(envelope.slice(2, 35));
    let tlv = envelope.slice(35);
    if ((envelope[1] & FLAG_COMPRESSED) !== 0) {
      try {
        tlv = await decompress(tlv);
      } catch {
        return null;
      }
    }
    const decoded = decodeParts(tlv);
    if (decoded == null) return null;
    const { senderAlias, sentAt, parts } = splitMeta(decoded);
    return { senderPubKeyHex, encrypted: false, parts, senderAlias, sentAt };
  }

  // src/messageBuilder.ts
  var ZERO_REF = "00".repeat(32);
  async function buildMessageTx(opts) {
    const sats = opts.outputSats ?? PHARLAP_OUTPUT_SATS;
    const notify = opts.notify ?? true;
    const tx = new Transaction();
    for (const f2 of opts.funding) {
      tx.addInput({
        sourceTransaction: f2.sourceTx,
        sourceOutputIndex: f2.utxo.outputIndex,
        unlockingScriptTemplate: new P2PKH().unlock(opts.key)
      });
    }
    const messageVout = tx.outputs.length;
    tx.addOutput({
      lockingScript: buildMessageScript(opts.recipientPubKeyHex, { ref: opts.ref ?? ZERO_REF, envelope: opts.envelope }),
      satoshis: sats
    });
    let notifyVout = null;
    if (notify) {
      const recipientAddress = PublicKey.fromString(opts.recipientPubKeyHex).toAddress();
      notifyVout = tx.outputs.length;
      tx.addOutput({ lockingScript: new P2PKH().lock(recipientAddress), satoshis: 1 });
    }
    const changeVout = tx.outputs.length;
    tx.addOutput({ lockingScript: new P2PKH().lock(opts.key.toAddress()), change: true });
    await tx.fee(new SatoshisPerKilobyte(opts.feePerKb ?? DEFAULT_FEE_PER_KB));
    await tx.sign();
    const changeSats = tx.outputs[changeVout]?.satoshis ?? 0;
    return { tx, txId: tx.id("hex"), messageVout, notifyVout, changeVout: changeSats > 0 ? changeVout : null, changeSats };
  }
  async function toFundingInputs2(provider2, utxos) {
    return Promise.all(utxos.map(async (u) => ({ utxo: u, sourceTx: await provider2.getSourceTransaction(u.txId) })));
  }
  async function sendMessage(provider2, key2, params) {
    const feePerKb = params.feePerKb ?? DEFAULT_FEE_PER_KB;
    const envelope = await buildEnvelope({
      senderPriv: key2,
      recipientPubKeyHex: params.toPubKeyHex,
      parts: params.parts,
      encrypt: params.encrypt,
      senderAlias: params.senderAlias,
      sentAt: params.sentAt ?? Date.now()
    });
    const estFee = Math.ceil((350 + envelope.length) * feePerKb / 1e3);
    const target = 2 * PHARLAP_OUTPUT_SATS + estFee + 500;
    const selected = selectFunding(await getSafeUtxos(provider2), target);
    const funding = await toFundingInputs2(provider2, selected);
    const r2 = await buildMessageTx({
      key: key2,
      funding,
      recipientPubKeyHex: params.toPubKeyHex,
      ref: params.ref,
      envelope,
      feePerKb
    });
    await provider2.broadcast(r2.tx.toHex());
    provider2.registerPendingTx(
      r2.txId,
      selected.map((u) => ({ txId: u.txId, outputIndex: u.outputIndex })),
      r2.changeVout != null ? { outputIndex: r2.changeVout, satoshis: r2.changeSats } : void 0
    );
    return { txId: r2.txId, messageOutpoint: { txId: r2.txId, outputIndex: r2.messageVout } };
  }
  async function scanIncomingMessages(provider2, recipientPriv) {
    const myPub = recipientPriv.toPublicKey().toString().toLowerCase();
    const candidateTxIds = /* @__PURE__ */ new Set();
    const heightByTx = /* @__PURE__ */ new Map();
    try {
      for (const h of await provider2.getAddressHistory()) {
        candidateTxIds.add(h.txId);
        heightByTx.set(h.txId, h.blockHeight || 0);
      }
    } catch {
    }
    try {
      for (const u of await provider2.getUtxos()) candidateTxIds.add(u.txId);
    } catch {
    }
    const found = [];
    const seen = /* @__PURE__ */ new Set();
    for (const txId of candidateTxIds) {
      let tx;
      try {
        tx = await provider2.getSourceTransaction(txId);
      } catch {
        continue;
      }
      for (let i = 0; i < tx.outputs.length; i++) {
        const parsed = parseMessageScript(tx.outputs[i].lockingScript);
        if (parsed == null || parsed.recipientPubKeyHex.toLowerCase() !== myPub) continue;
        const key2 = `${txId}:${i}`;
        if (seen.has(key2)) continue;
        seen.add(key2);
        const opened = await openEnvelope(parsed.fields.envelope, recipientPriv);
        if (opened == null) continue;
        found.push({
          txId,
          outputIndex: i,
          ref: parsed.fields.ref,
          senderPubKeyHex: opened.senderPubKeyHex,
          encrypted: opened.encrypted,
          parts: opened.parts,
          senderAlias: opened.senderAlias,
          sentAt: opened.sentAt,
          height: heightByTx.get(txId) ?? 0
        });
      }
    }
    const rank = (m) => m.height != null && m.height > 0 ? m.height : Number.MAX_SAFE_INTEGER;
    return found.sort((a, b) => rank(b) - rank(a) || (b.sentAt ?? 0) - (a.sentAt ?? 0));
  }

  // src/broadcast.ts
  var MAX_BROADCAST_BYTES = 480;
  var MAX_BROADCAST_SCAN = 50;
  async function publishBroadcast(provider2, key2, collectionId, text, senderAlias) {
    const trimmed = text.trim();
    if (trimmed.length === 0) throw new Error("announcement is empty");
    if (new TextEncoder().encode(trimmed).length > MAX_BROADCAST_BYTES) {
      throw new Error(`announcement exceeds ${MAX_BROADCAST_BYTES} bytes`);
    }
    const pubHex = key2.toPublicKey().toString();
    const envelope = await buildEnvelope({
      senderPriv: key2,
      recipientPubKeyHex: pubHex,
      parts: [{ kind: "text", text: trimmed }],
      encrypt: false,
      senderAlias,
      sentAt: Date.now()
    });
    const selected = selectFunding(await getSafeUtxos(provider2), PHARLAP_OUTPUT_SATS + 600);
    const funding = await Promise.all(
      selected.map(async (u) => ({ utxo: u, sourceTx: await provider2.getSourceTransaction(u.txId) }))
    );
    const tx = new Transaction();
    for (const f2 of funding) {
      tx.addInput({
        sourceTransaction: f2.sourceTx,
        sourceOutputIndex: f2.utxo.outputIndex,
        unlockingScriptTemplate: new P2PKH().unlock(key2)
      });
    }
    tx.addOutput({
      lockingScript: buildMessageScript(pubHex, { ref: collectionId, envelope }),
      satoshis: PHARLAP_OUTPUT_SATS
    });
    tx.addOutput({ lockingScript: new P2PKH().lock(key2.toAddress()), change: true });
    await tx.fee(new SatoshisPerKilobyte(DEFAULT_FEE_PER_KB));
    await tx.sign();
    await provider2.broadcast(tx.toHex());
    const txId = tx.id("hex");
    provider2.registerPendingTx(
      txId,
      selected.map((u) => ({ txId: u.txId, outputIndex: u.outputIndex })),
      (tx.outputs[1]?.satoshis ?? 0) > 0 ? { outputIndex: 1, satoshis: tx.outputs[1].satoshis ?? 0 } : void 0
    );
    return txId;
  }
  async function resolveBroadcasts(provider2, publisherPubKeyHex, collectionId) {
    const address2 = PublicKey.fromString(publisherPubKeyHex).toAddress();
    const heightByTx = /* @__PURE__ */ new Map();
    try {
      for (const h of await provider2.getAddressHistory(address2)) heightByTx.set(h.txId, h.blockHeight || 0);
    } catch {
    }
    try {
      for (const txId of await provider2.getRecentTxIdsForAddress(address2)) {
        if (!heightByTx.has(txId)) heightByTx.set(txId, 0);
      }
    } catch {
    }
    if (heightByTx.size === 0) return [];
    const ordered = [...heightByTx.entries()].sort((a, b) => (b[1] || 1e12) - (a[1] || 1e12)).slice(0, MAX_BROADCAST_SCAN);
    const publisher = publisherPubKeyHex.toLowerCase();
    const want = collectionId.toLowerCase();
    const out = [];
    for (const [txId, height] of ordered) {
      let tx;
      try {
        tx = await provider2.getSourceTransaction(txId);
      } catch {
        continue;
      }
      for (const o of tx.outputs) {
        const m = parseMessageScript(o.lockingScript);
        if (m == null) continue;
        if (m.recipientPubKeyHex.toLowerCase() !== publisher) continue;
        if (m.fields.ref.toLowerCase() !== want) continue;
        const opened = await openPublicEnvelope(m.fields.envelope);
        if (opened == null || opened.senderPubKeyHex.toLowerCase() !== publisher) continue;
        const textPart = opened.parts.find((p) => p.kind === "text");
        if (textPart && textPart.kind === "text") out.push({ text: textPart.text, txId, height, senderAlias: opened.senderAlias });
      }
    }
    return out;
  }

  // src/qrcodegen.ts
  var qrcodegen;
  ((qrcodegen2) => {
    const _QrCode = class _QrCode {
      /*-- Constructor (low level) and fields --*/
      // Creates a new QR Code with the given version number,
      // error correction level, data codeword bytes, and mask number.
      // This is a low-level API that most users should not use directly.
      // A mid-level API is the encodeSegments() function.
      constructor(version, errorCorrectionLevel, dataCodewords, msk) {
        this.version = version;
        this.errorCorrectionLevel = errorCorrectionLevel;
        // The modules of this QR Code (false = light, true = dark).
        // Immutable after constructor finishes. Accessed through getModule().
        this.modules = [];
        // Indicates function modules that are not subjected to masking. Discarded when constructor finishes.
        this.isFunction = [];
        if (version < _QrCode.MIN_VERSION || version > _QrCode.MAX_VERSION)
          throw new RangeError("Version value out of range");
        if (msk < -1 || msk > 7)
          throw new RangeError("Mask value out of range");
        this.size = version * 4 + 17;
        let row = [];
        for (let i = 0; i < this.size; i++)
          row.push(false);
        for (let i = 0; i < this.size; i++) {
          this.modules.push(row.slice());
          this.isFunction.push(row.slice());
        }
        this.drawFunctionPatterns();
        const allCodewords = this.addEccAndInterleave(dataCodewords);
        this.drawCodewords(allCodewords);
        if (msk == -1) {
          let minPenalty = 1e9;
          for (let i = 0; i < 8; i++) {
            this.applyMask(i);
            this.drawFormatBits(i);
            const penalty = this.getPenaltyScore();
            if (penalty < minPenalty) {
              msk = i;
              minPenalty = penalty;
            }
            this.applyMask(i);
          }
        }
        assert2(0 <= msk && msk <= 7);
        this.mask = msk;
        this.applyMask(msk);
        this.drawFormatBits(msk);
        this.isFunction = [];
      }
      /*-- Static factory functions (high level) --*/
      // Returns a QR Code representing the given Unicode text string at the given error correction level.
      // As a conservative upper bound, this function is guaranteed to succeed for strings that have 738 or fewer
      // Unicode code points (not UTF-16 code units) if the low error correction level is used. The smallest possible
      // QR Code version is automatically chosen for the output. The ECC level of the result may be higher than the
      // ecl argument if it can be done without increasing the version.
      static encodeText(text, ecl) {
        const segs = qrcodegen2.QrSegment.makeSegments(text);
        return _QrCode.encodeSegments(segs, ecl);
      }
      // Returns a QR Code representing the given binary data at the given error correction level.
      // This function always encodes using the binary segment mode, not any text mode. The maximum number of
      // bytes allowed is 2953. The smallest possible QR Code version is automatically chosen for the output.
      // The ECC level of the result may be higher than the ecl argument if it can be done without increasing the version.
      static encodeBinary(data, ecl) {
        const seg = qrcodegen2.QrSegment.makeBytes(data);
        return _QrCode.encodeSegments([seg], ecl);
      }
      /*-- Static factory functions (mid level) --*/
      // Returns a QR Code representing the given segments with the given encoding parameters.
      // The smallest possible QR Code version within the given range is automatically
      // chosen for the output. Iff boostEcl is true, then the ECC level of the result
      // may be higher than the ecl argument if it can be done without increasing the
      // version. The mask number is either between 0 to 7 (inclusive) to force that
      // mask, or -1 to automatically choose an appropriate mask (which may be slow).
      // This function allows the user to create a custom sequence of segments that switches
      // between modes (such as alphanumeric and byte) to encode text in less space.
      // This is a mid-level API; the high-level API is encodeText() and encodeBinary().
      static encodeSegments(segs, ecl, minVersion = 1, maxVersion = 40, mask = -1, boostEcl = true) {
        if (!(_QrCode.MIN_VERSION <= minVersion && minVersion <= maxVersion && maxVersion <= _QrCode.MAX_VERSION) || mask < -1 || mask > 7)
          throw new RangeError("Invalid value");
        let version;
        let dataUsedBits;
        for (version = minVersion; ; version++) {
          const dataCapacityBits2 = _QrCode.getNumDataCodewords(version, ecl) * 8;
          const usedBits = QrSegment.getTotalBits(segs, version);
          if (usedBits <= dataCapacityBits2) {
            dataUsedBits = usedBits;
            break;
          }
          if (version >= maxVersion)
            throw new RangeError("Data too long");
        }
        for (const newEcl of [_QrCode.Ecc.MEDIUM, _QrCode.Ecc.QUARTILE, _QrCode.Ecc.HIGH]) {
          if (boostEcl && dataUsedBits <= _QrCode.getNumDataCodewords(version, newEcl) * 8)
            ecl = newEcl;
        }
        let bb = [];
        for (const seg of segs) {
          appendBits(seg.mode.modeBits, 4, bb);
          appendBits(seg.numChars, seg.mode.numCharCountBits(version), bb);
          for (const b of seg.getData())
            bb.push(b);
        }
        assert2(bb.length == dataUsedBits);
        const dataCapacityBits = _QrCode.getNumDataCodewords(version, ecl) * 8;
        assert2(bb.length <= dataCapacityBits);
        appendBits(0, Math.min(4, dataCapacityBits - bb.length), bb);
        appendBits(0, (8 - bb.length % 8) % 8, bb);
        assert2(bb.length % 8 == 0);
        for (let padByte = 236; bb.length < dataCapacityBits; padByte ^= 236 ^ 17)
          appendBits(padByte, 8, bb);
        let dataCodewords = [];
        while (dataCodewords.length * 8 < bb.length)
          dataCodewords.push(0);
        bb.forEach((b, i) => dataCodewords[i >>> 3] |= b << 7 - (i & 7));
        return new _QrCode(version, ecl, dataCodewords, mask);
      }
      /*-- Accessor methods --*/
      // Returns the color of the module (pixel) at the given coordinates, which is false
      // for light or true for dark. The top left corner has the coordinates (x=0, y=0).
      // If the given coordinates are out of bounds, then false (light) is returned.
      getModule(x, y) {
        return 0 <= x && x < this.size && 0 <= y && y < this.size && this.modules[y][x];
      }
      /*-- Private helper methods for constructor: Drawing function modules --*/
      // Reads this object's version field, and draws and marks all function modules.
      drawFunctionPatterns() {
        for (let i = 0; i < this.size; i++) {
          this.setFunctionModule(6, i, i % 2 == 0);
          this.setFunctionModule(i, 6, i % 2 == 0);
        }
        this.drawFinderPattern(3, 3);
        this.drawFinderPattern(this.size - 4, 3);
        this.drawFinderPattern(3, this.size - 4);
        const alignPatPos = this.getAlignmentPatternPositions();
        const numAlign = alignPatPos.length;
        for (let i = 0; i < numAlign; i++) {
          for (let j = 0; j < numAlign; j++) {
            if (!(i == 0 && j == 0 || i == 0 && j == numAlign - 1 || i == numAlign - 1 && j == 0))
              this.drawAlignmentPattern(alignPatPos[i], alignPatPos[j]);
          }
        }
        this.drawFormatBits(0);
        this.drawVersion();
      }
      // Draws two copies of the format bits (with its own error correction code)
      // based on the given mask and this object's error correction level field.
      drawFormatBits(mask) {
        const data = this.errorCorrectionLevel.formatBits << 3 | mask;
        let rem = data;
        for (let i = 0; i < 10; i++)
          rem = rem << 1 ^ (rem >>> 9) * 1335;
        const bits = (data << 10 | rem) ^ 21522;
        assert2(bits >>> 15 == 0);
        for (let i = 0; i <= 5; i++)
          this.setFunctionModule(8, i, getBit(bits, i));
        this.setFunctionModule(8, 7, getBit(bits, 6));
        this.setFunctionModule(8, 8, getBit(bits, 7));
        this.setFunctionModule(7, 8, getBit(bits, 8));
        for (let i = 9; i < 15; i++)
          this.setFunctionModule(14 - i, 8, getBit(bits, i));
        for (let i = 0; i < 8; i++)
          this.setFunctionModule(this.size - 1 - i, 8, getBit(bits, i));
        for (let i = 8; i < 15; i++)
          this.setFunctionModule(8, this.size - 15 + i, getBit(bits, i));
        this.setFunctionModule(8, this.size - 8, true);
      }
      // Draws two copies of the version bits (with its own error correction code),
      // based on this object's version field, iff 7 <= version <= 40.
      drawVersion() {
        if (this.version < 7)
          return;
        let rem = this.version;
        for (let i = 0; i < 12; i++)
          rem = rem << 1 ^ (rem >>> 11) * 7973;
        const bits = this.version << 12 | rem;
        assert2(bits >>> 18 == 0);
        for (let i = 0; i < 18; i++) {
          const color = getBit(bits, i);
          const a = this.size - 11 + i % 3;
          const b = Math.floor(i / 3);
          this.setFunctionModule(a, b, color);
          this.setFunctionModule(b, a, color);
        }
      }
      // Draws a 9*9 finder pattern including the border separator,
      // with the center module at (x, y). Modules can be out of bounds.
      drawFinderPattern(x, y) {
        for (let dy = -4; dy <= 4; dy++) {
          for (let dx = -4; dx <= 4; dx++) {
            const dist = Math.max(Math.abs(dx), Math.abs(dy));
            const xx = x + dx;
            const yy = y + dy;
            if (0 <= xx && xx < this.size && 0 <= yy && yy < this.size)
              this.setFunctionModule(xx, yy, dist != 2 && dist != 4);
          }
        }
      }
      // Draws a 5*5 alignment pattern, with the center module
      // at (x, y). All modules must be in bounds.
      drawAlignmentPattern(x, y) {
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++)
            this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) != 1);
        }
      }
      // Sets the color of a module and marks it as a function module.
      // Only used by the constructor. Coordinates must be in bounds.
      setFunctionModule(x, y, isDark) {
        this.modules[y][x] = isDark;
        this.isFunction[y][x] = true;
      }
      /*-- Private helper methods for constructor: Codewords and masking --*/
      // Returns a new byte string representing the given data with the appropriate error correction
      // codewords appended to it, based on this object's version and error correction level.
      addEccAndInterleave(data) {
        const ver = this.version;
        const ecl = this.errorCorrectionLevel;
        if (data.length != _QrCode.getNumDataCodewords(ver, ecl))
          throw new RangeError("Invalid argument");
        const numBlocks = _QrCode.NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver];
        const blockEccLen = _QrCode.ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver];
        const rawCodewords = Math.floor(_QrCode.getNumRawDataModules(ver) / 8);
        const numShortBlocks = numBlocks - rawCodewords % numBlocks;
        const shortBlockLen = Math.floor(rawCodewords / numBlocks);
        let blocks = [];
        const rsDiv = _QrCode.reedSolomonComputeDivisor(blockEccLen);
        for (let i = 0, k = 0; i < numBlocks; i++) {
          let dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
          k += dat.length;
          const ecc = _QrCode.reedSolomonComputeRemainder(dat, rsDiv);
          if (i < numShortBlocks)
            dat.push(0);
          blocks.push(dat.concat(ecc));
        }
        let result = [];
        for (let i = 0; i < blocks[0].length; i++) {
          blocks.forEach((block, j) => {
            if (i != shortBlockLen - blockEccLen || j >= numShortBlocks)
              result.push(block[i]);
          });
        }
        assert2(result.length == rawCodewords);
        return result;
      }
      // Draws the given sequence of 8-bit codewords (data and error correction) onto the entire
      // data area of this QR Code. Function modules need to be marked off before this is called.
      drawCodewords(data) {
        if (data.length != Math.floor(_QrCode.getNumRawDataModules(this.version) / 8))
          throw new RangeError("Invalid argument");
        let i = 0;
        for (let right = this.size - 1; right >= 1; right -= 2) {
          if (right == 6)
            right = 5;
          for (let vert = 0; vert < this.size; vert++) {
            for (let j = 0; j < 2; j++) {
              const x = right - j;
              const upward = (right + 1 & 2) == 0;
              const y = upward ? this.size - 1 - vert : vert;
              if (!this.isFunction[y][x] && i < data.length * 8) {
                this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
                i++;
              }
            }
          }
        }
        assert2(i == data.length * 8);
      }
      // XORs the codeword modules in this QR Code with the given mask pattern.
      // The function modules must be marked and the codeword bits must be drawn
      // before masking. Due to the arithmetic of XOR, calling applyMask() with
      // the same mask value a second time will undo the mask. A final well-formed
      // QR Code needs exactly one (not zero, two, etc.) mask applied.
      applyMask(mask) {
        if (mask < 0 || mask > 7)
          throw new RangeError("Mask value out of range");
        for (let y = 0; y < this.size; y++) {
          for (let x = 0; x < this.size; x++) {
            let invert;
            switch (mask) {
              case 0:
                invert = (x + y) % 2 == 0;
                break;
              case 1:
                invert = y % 2 == 0;
                break;
              case 2:
                invert = x % 3 == 0;
                break;
              case 3:
                invert = (x + y) % 3 == 0;
                break;
              case 4:
                invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 == 0;
                break;
              case 5:
                invert = x * y % 2 + x * y % 3 == 0;
                break;
              case 6:
                invert = (x * y % 2 + x * y % 3) % 2 == 0;
                break;
              case 7:
                invert = ((x + y) % 2 + x * y % 3) % 2 == 0;
                break;
              default:
                throw new Error("Unreachable");
            }
            if (!this.isFunction[y][x] && invert)
              this.modules[y][x] = !this.modules[y][x];
          }
        }
      }
      // Calculates and returns the penalty score based on state of this QR Code's current modules.
      // This is used by the automatic mask choice algorithm to find the mask pattern that yields the lowest score.
      getPenaltyScore() {
        let result = 0;
        for (let y = 0; y < this.size; y++) {
          let runColor = false;
          let runX = 0;
          let runHistory = [0, 0, 0, 0, 0, 0, 0];
          for (let x = 0; x < this.size; x++) {
            if (this.modules[y][x] == runColor) {
              runX++;
              if (runX == 5)
                result += _QrCode.PENALTY_N1;
              else if (runX > 5)
                result++;
            } else {
              this.finderPenaltyAddHistory(runX, runHistory);
              if (!runColor)
                result += this.finderPenaltyCountPatterns(runHistory) * _QrCode.PENALTY_N3;
              runColor = this.modules[y][x];
              runX = 1;
            }
          }
          result += this.finderPenaltyTerminateAndCount(runColor, runX, runHistory) * _QrCode.PENALTY_N3;
        }
        for (let x = 0; x < this.size; x++) {
          let runColor = false;
          let runY = 0;
          let runHistory = [0, 0, 0, 0, 0, 0, 0];
          for (let y = 0; y < this.size; y++) {
            if (this.modules[y][x] == runColor) {
              runY++;
              if (runY == 5)
                result += _QrCode.PENALTY_N1;
              else if (runY > 5)
                result++;
            } else {
              this.finderPenaltyAddHistory(runY, runHistory);
              if (!runColor)
                result += this.finderPenaltyCountPatterns(runHistory) * _QrCode.PENALTY_N3;
              runColor = this.modules[y][x];
              runY = 1;
            }
          }
          result += this.finderPenaltyTerminateAndCount(runColor, runY, runHistory) * _QrCode.PENALTY_N3;
        }
        for (let y = 0; y < this.size - 1; y++) {
          for (let x = 0; x < this.size - 1; x++) {
            const color = this.modules[y][x];
            if (color == this.modules[y][x + 1] && color == this.modules[y + 1][x] && color == this.modules[y + 1][x + 1])
              result += _QrCode.PENALTY_N2;
          }
        }
        let dark = 0;
        for (const row of this.modules)
          dark = row.reduce((sum, color) => sum + (color ? 1 : 0), dark);
        const total = this.size * this.size;
        const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
        assert2(0 <= k && k <= 9);
        result += k * _QrCode.PENALTY_N4;
        assert2(0 <= result && result <= 2568888);
        return result;
      }
      /*-- Private helper functions --*/
      // Returns an ascending list of positions of alignment patterns for this version number.
      // Each position is in the range [0,177), and are used on both the x and y axes.
      // This could be implemented as lookup table of 40 variable-length lists of integers.
      getAlignmentPatternPositions() {
        if (this.version == 1)
          return [];
        else {
          const numAlign = Math.floor(this.version / 7) + 2;
          const step = Math.floor((this.version * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
          let result = [6];
          for (let pos = this.size - 7; result.length < numAlign; pos -= step)
            result.splice(1, 0, pos);
          return result;
        }
      }
      // Returns the number of data bits that can be stored in a QR Code of the given version number, after
      // all function modules are excluded. This includes remainder bits, so it might not be a multiple of 8.
      // The result is in the range [208, 29648]. This could be implemented as a 40-entry lookup table.
      static getNumRawDataModules(ver) {
        if (ver < _QrCode.MIN_VERSION || ver > _QrCode.MAX_VERSION)
          throw new RangeError("Version number out of range");
        let result = (16 * ver + 128) * ver + 64;
        if (ver >= 2) {
          const numAlign = Math.floor(ver / 7) + 2;
          result -= (25 * numAlign - 10) * numAlign - 55;
          if (ver >= 7)
            result -= 36;
        }
        assert2(208 <= result && result <= 29648);
        return result;
      }
      // Returns the number of 8-bit data (i.e. not error correction) codewords contained in any
      // QR Code of the given version number and error correction level, with remainder bits discarded.
      // This stateless pure function could be implemented as a (40*4)-cell lookup table.
      static getNumDataCodewords(ver, ecl) {
        return Math.floor(_QrCode.getNumRawDataModules(ver) / 8) - _QrCode.ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver] * _QrCode.NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver];
      }
      // Returns a Reed-Solomon ECC generator polynomial for the given degree. This could be
      // implemented as a lookup table over all possible parameter values, instead of as an algorithm.
      static reedSolomonComputeDivisor(degree) {
        if (degree < 1 || degree > 255)
          throw new RangeError("Degree out of range");
        let result = [];
        for (let i = 0; i < degree - 1; i++)
          result.push(0);
        result.push(1);
        let root = 1;
        for (let i = 0; i < degree; i++) {
          for (let j = 0; j < result.length; j++) {
            result[j] = _QrCode.reedSolomonMultiply(result[j], root);
            if (j + 1 < result.length)
              result[j] ^= result[j + 1];
          }
          root = _QrCode.reedSolomonMultiply(root, 2);
        }
        return result;
      }
      // Returns the Reed-Solomon error correction codeword for the given data and divisor polynomials.
      static reedSolomonComputeRemainder(data, divisor) {
        let result = divisor.map((_) => 0);
        for (const b of data) {
          const factor = b ^ result.shift();
          result.push(0);
          divisor.forEach((coef, i) => result[i] ^= _QrCode.reedSolomonMultiply(coef, factor));
        }
        return result;
      }
      // Returns the product of the two given field elements modulo GF(2^8/0x11D). The arguments and result
      // are unsigned 8-bit integers. This could be implemented as a lookup table of 256*256 entries of uint8.
      static reedSolomonMultiply(x, y) {
        if (x >>> 8 != 0 || y >>> 8 != 0)
          throw new RangeError("Byte out of range");
        let z = 0;
        for (let i = 7; i >= 0; i--) {
          z = z << 1 ^ (z >>> 7) * 285;
          z ^= (y >>> i & 1) * x;
        }
        assert2(z >>> 8 == 0);
        return z;
      }
      // Can only be called immediately after a light run is added, and
      // returns either 0, 1, or 2. A helper function for getPenaltyScore().
      finderPenaltyCountPatterns(runHistory) {
        const n = runHistory[1];
        assert2(n <= this.size * 3);
        const core = n > 0 && runHistory[2] == n && runHistory[3] == n * 3 && runHistory[4] == n && runHistory[5] == n;
        return (core && runHistory[0] >= n * 4 && runHistory[6] >= n ? 1 : 0) + (core && runHistory[6] >= n * 4 && runHistory[0] >= n ? 1 : 0);
      }
      // Must be called at the end of a line (row or column) of modules. A helper function for getPenaltyScore().
      finderPenaltyTerminateAndCount(currentRunColor, currentRunLength, runHistory) {
        if (currentRunColor) {
          this.finderPenaltyAddHistory(currentRunLength, runHistory);
          currentRunLength = 0;
        }
        currentRunLength += this.size;
        this.finderPenaltyAddHistory(currentRunLength, runHistory);
        return this.finderPenaltyCountPatterns(runHistory);
      }
      // Pushes the given value to the front and drops the last value. A helper function for getPenaltyScore().
      finderPenaltyAddHistory(currentRunLength, runHistory) {
        if (runHistory[0] == 0)
          currentRunLength += this.size;
        runHistory.pop();
        runHistory.unshift(currentRunLength);
      }
    };
    /*-- Constants and tables --*/
    // The minimum version number supported in the QR Code Model 2 standard.
    _QrCode.MIN_VERSION = 1;
    // The maximum version number supported in the QR Code Model 2 standard.
    _QrCode.MAX_VERSION = 40;
    // For use in getPenaltyScore(), when evaluating which mask is best.
    _QrCode.PENALTY_N1 = 3;
    _QrCode.PENALTY_N2 = 3;
    _QrCode.PENALTY_N3 = 40;
    _QrCode.PENALTY_N4 = 10;
    _QrCode.ECC_CODEWORDS_PER_BLOCK = [
      // Version: (note that index 0 is for padding, and is set to an illegal value)
      //0,  1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40    Error correction level
      [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
      // Low
      [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
      // Medium
      [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
      // Quartile
      [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
      // High
    ];
    _QrCode.NUM_ERROR_CORRECTION_BLOCKS = [
      // Version: (note that index 0 is for padding, and is set to an illegal value)
      //0, 1, 2, 3, 4, 5, 6, 7, 8, 9,10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40    Error correction level
      [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
      // Low
      [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
      // Medium
      [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
      // Quartile
      [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
      // High
    ];
    let QrCode2 = _QrCode;
    qrcodegen2.QrCode = _QrCode;
    function appendBits(val2, len, bb) {
      if (len < 0 || len > 31 || val2 >>> len != 0)
        throw new RangeError("Value out of range");
      for (let i = len - 1; i >= 0; i--)
        bb.push(val2 >>> i & 1);
    }
    function getBit(x, i) {
      return (x >>> i & 1) != 0;
    }
    function assert2(cond) {
      if (!cond)
        throw new Error("Assertion error");
    }
    const _QrSegment = class _QrSegment {
      /*-- Constructor (low level) and fields --*/
      // Creates a new QR Code segment with the given attributes and data.
      // The character count (numChars) must agree with the mode and the bit buffer length,
      // but the constraint isn't checked. The given bit buffer is cloned and stored.
      constructor(mode, numChars, bitData) {
        this.mode = mode;
        this.numChars = numChars;
        this.bitData = bitData;
        if (numChars < 0)
          throw new RangeError("Invalid argument");
        this.bitData = bitData.slice();
      }
      /*-- Static factory functions (mid level) --*/
      // Returns a segment representing the given binary data encoded in
      // byte mode. All input byte arrays are acceptable. Any text string
      // can be converted to UTF-8 bytes and encoded as a byte mode segment.
      static makeBytes(data) {
        let bb = [];
        for (const b of data)
          appendBits(b, 8, bb);
        return new _QrSegment(_QrSegment.Mode.BYTE, data.length, bb);
      }
      // Returns a segment representing the given string of decimal digits encoded in numeric mode.
      static makeNumeric(digits) {
        if (!_QrSegment.isNumeric(digits))
          throw new RangeError("String contains non-numeric characters");
        let bb = [];
        for (let i = 0; i < digits.length; ) {
          const n = Math.min(digits.length - i, 3);
          appendBits(parseInt(digits.substring(i, i + n), 10), n * 3 + 1, bb);
          i += n;
        }
        return new _QrSegment(_QrSegment.Mode.NUMERIC, digits.length, bb);
      }
      // Returns a segment representing the given text string encoded in alphanumeric mode.
      // The characters allowed are: 0 to 9, A to Z (uppercase only), space,
      // dollar, percent, asterisk, plus, hyphen, period, slash, colon.
      static makeAlphanumeric(text) {
        if (!_QrSegment.isAlphanumeric(text))
          throw new RangeError("String contains unencodable characters in alphanumeric mode");
        let bb = [];
        let i;
        for (i = 0; i + 2 <= text.length; i += 2) {
          let temp = _QrSegment.ALPHANUMERIC_CHARSET.indexOf(text.charAt(i)) * 45;
          temp += _QrSegment.ALPHANUMERIC_CHARSET.indexOf(text.charAt(i + 1));
          appendBits(temp, 11, bb);
        }
        if (i < text.length)
          appendBits(_QrSegment.ALPHANUMERIC_CHARSET.indexOf(text.charAt(i)), 6, bb);
        return new _QrSegment(_QrSegment.Mode.ALPHANUMERIC, text.length, bb);
      }
      // Returns a new mutable list of zero or more segments to represent the given Unicode text string.
      // The result may use various segment modes and switch modes to optimize the length of the bit stream.
      static makeSegments(text) {
        if (text == "")
          return [];
        else if (_QrSegment.isNumeric(text))
          return [_QrSegment.makeNumeric(text)];
        else if (_QrSegment.isAlphanumeric(text))
          return [_QrSegment.makeAlphanumeric(text)];
        else
          return [_QrSegment.makeBytes(_QrSegment.toUtf8ByteArray(text))];
      }
      // Returns a segment representing an Extended Channel Interpretation
      // (ECI) designator with the given assignment value.
      static makeEci(assignVal) {
        let bb = [];
        if (assignVal < 0)
          throw new RangeError("ECI assignment value out of range");
        else if (assignVal < 1 << 7)
          appendBits(assignVal, 8, bb);
        else if (assignVal < 1 << 14) {
          appendBits(2, 2, bb);
          appendBits(assignVal, 14, bb);
        } else if (assignVal < 1e6) {
          appendBits(6, 3, bb);
          appendBits(assignVal, 21, bb);
        } else
          throw new RangeError("ECI assignment value out of range");
        return new _QrSegment(_QrSegment.Mode.ECI, 0, bb);
      }
      // Tests whether the given string can be encoded as a segment in numeric mode.
      // A string is encodable iff each character is in the range 0 to 9.
      static isNumeric(text) {
        return _QrSegment.NUMERIC_REGEX.test(text);
      }
      // Tests whether the given string can be encoded as a segment in alphanumeric mode.
      // A string is encodable iff each character is in the following set: 0 to 9, A to Z
      // (uppercase only), space, dollar, percent, asterisk, plus, hyphen, period, slash, colon.
      static isAlphanumeric(text) {
        return _QrSegment.ALPHANUMERIC_REGEX.test(text);
      }
      /*-- Methods --*/
      // Returns a new copy of the data bits of this segment.
      getData() {
        return this.bitData.slice();
      }
      // (Package-private) Calculates and returns the number of bits needed to encode the given segments at
      // the given version. The result is infinity if a segment has too many characters to fit its length field.
      static getTotalBits(segs, version) {
        let result = 0;
        for (const seg of segs) {
          const ccbits = seg.mode.numCharCountBits(version);
          if (seg.numChars >= 1 << ccbits)
            return Infinity;
          result += 4 + ccbits + seg.bitData.length;
        }
        return result;
      }
      // Returns a new array of bytes representing the given string encoded in UTF-8.
      static toUtf8ByteArray(str) {
        str = encodeURI(str);
        let result = [];
        for (let i = 0; i < str.length; i++) {
          if (str.charAt(i) != "%")
            result.push(str.charCodeAt(i));
          else {
            result.push(parseInt(str.substring(i + 1, i + 3), 16));
            i += 2;
          }
        }
        return result;
      }
    };
    /*-- Constants --*/
    // Describes precisely all strings that are encodable in numeric mode.
    _QrSegment.NUMERIC_REGEX = /^[0-9]*$/;
    // Describes precisely all strings that are encodable in alphanumeric mode.
    _QrSegment.ALPHANUMERIC_REGEX = /^[A-Z0-9 $%*+.\/:-]*$/;
    // The set of all legal characters in alphanumeric mode,
    // where each character value maps to the index in the string.
    _QrSegment.ALPHANUMERIC_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
    let QrSegment = _QrSegment;
    qrcodegen2.QrSegment = _QrSegment;
  })(qrcodegen || (qrcodegen = {}));
  ((qrcodegen2) => {
    let QrCode2;
    ((QrCode3) => {
      const _Ecc = class _Ecc {
        // The QR Code can tolerate about 30% erroneous codewords
        /*-- Constructor and fields --*/
        constructor(ordinal, formatBits) {
          this.ordinal = ordinal;
          this.formatBits = formatBits;
        }
      };
      /*-- Constants --*/
      _Ecc.LOW = new _Ecc(0, 1);
      // The QR Code can tolerate about  7% erroneous codewords
      _Ecc.MEDIUM = new _Ecc(1, 0);
      // The QR Code can tolerate about 15% erroneous codewords
      _Ecc.QUARTILE = new _Ecc(2, 3);
      // The QR Code can tolerate about 25% erroneous codewords
      _Ecc.HIGH = new _Ecc(3, 2);
      let Ecc = _Ecc;
      QrCode3.Ecc = _Ecc;
    })(QrCode2 = qrcodegen2.QrCode || (qrcodegen2.QrCode = {}));
  })(qrcodegen || (qrcodegen = {}));
  ((qrcodegen2) => {
    let QrSegment;
    ((QrSegment2) => {
      const _Mode = class _Mode {
        /*-- Constructor and fields --*/
        constructor(modeBits, numBitsCharCount) {
          this.modeBits = modeBits;
          this.numBitsCharCount = numBitsCharCount;
        }
        /*-- Method --*/
        // (Package-private) Returns the bit width of the character count field for a segment in
        // this mode in a QR Code at the given version number. The result is in the range [0, 16].
        numCharCountBits(ver) {
          return this.numBitsCharCount[Math.floor((ver + 7) / 17)];
        }
      };
      /*-- Constants --*/
      _Mode.NUMERIC = new _Mode(1, [10, 12, 14]);
      _Mode.ALPHANUMERIC = new _Mode(2, [9, 11, 13]);
      _Mode.BYTE = new _Mode(4, [8, 16, 16]);
      _Mode.KANJI = new _Mode(8, [8, 10, 12]);
      _Mode.ECI = new _Mode(7, [0, 0, 0]);
      let Mode = _Mode;
      QrSegment2.Mode = _Mode;
    })(QrSegment = qrcodegen2.QrSegment || (qrcodegen2.QrSegment = {}));
  })(qrcodegen || (qrcodegen = {}));

  // src/qr.ts
  var QrCode = qrcodegen.QrCode;
  function bsvPaymentUri(address2, amountSats) {
    if (amountSats == null || amountSats <= 0) return address2;
    const bsv = (amountSats / 1e8).toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
    return `bitcoin:${address2}?amount=${bsv}`;
  }
  function qrSvg(text, opts) {
    const border = opts?.border ?? 3;
    const dark = opts?.dark ?? "#000000";
    const light = opts?.light ?? "#ffffff";
    const qr = QrCode.encodeText(text, QrCode.Ecc.MEDIUM);
    const dim = qr.size + border * 2;
    let path = "";
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        if (qr.getModule(x, y)) path += `${path ? " " : ""}M${x + border},${y + border}h1v1h-1z`;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${dim}" height="${dim}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
  }

  // src/verify.ts
  async function verifyTokenLineage(tokenTx, outputIndex, deps) {
    const tokenOut = tokenTx.outputs[outputIndex];
    const token = tokenOut ? parseTokenScript(tokenOut.lockingScript) : null;
    if (token == null) return { valid: false, reason: "output is not a PHAR LAP token" };
    const collectionId = token.fields.tx1Ref;
    let tx1;
    try {
      tx1 = await deps.getRawTransaction(collectionId);
    } catch {
      return { valid: false, reason: `cannot fetch collection TX1 ${collectionId.slice(0, 12)}\u2026`, collectionId };
    }
    const hasTemplate = tx1.outputs.some((o) => parseTemplateScript(o.lockingScript) != null);
    if (!hasTemplate) {
      return { valid: false, reason: "TX1 has no TEMPLATE output \u2014 invalid collection anchor", collectionId };
    }
    const input0 = tokenTx.inputs[0];
    const parentTxId = input0?.sourceTXID ?? input0?.sourceTransaction?.id("hex");
    const parentVout = input0?.sourceOutputIndex;
    if (parentTxId == null || parentVout == null) {
      return { valid: false, reason: "token tx has no input 0", collectionId };
    }
    let isGenesis;
    try {
      const parentTx = await deps.getRawTransaction(parentTxId);
      const parentOut = parentTx.outputs[parentVout];
      const parentToken = parentOut ? parseTokenScript(parentOut.lockingScript) : null;
      isGenesis = !(parentToken != null && parentToken.fields.tx1Ref === collectionId);
    } catch {
      return { valid: false, reason: "cannot fetch immediate parent tx", collectionId };
    }
    if (deps.getProof != null && deps.chainTracker != null) {
      const proofTxId = isGenesis ? tokenTx.id("hex") : parentTxId;
      const proof = await deps.getProof(proofTxId);
      if (proof != null) {
        const ok = await proof.verify(proofTxId, deps.chainTracker);
        if (!ok) {
          return { valid: false, reason: "Merkle proof did not verify against the chain", collectionId, isGenesis };
        }
        return {
          valid: true,
          reason: isGenesis ? "valid genesis token (confirmed)" : "valid descendant token (parent confirmed)",
          collectionId,
          isGenesis
        };
      }
      return {
        valid: true,
        reason: isGenesis ? "valid genesis token (unconfirmed)" : "valid descendant token (unconfirmed)",
        collectionId,
        isGenesis,
        unconfirmed: true
      };
    }
    return {
      valid: true,
      reason: isGenesis ? "valid genesis token (structure only)" : "valid descendant token (structure only)",
      collectionId,
      isGenesis,
      unconfirmed: true
    };
  }

  // src/thumbs.ts
  var PREFIX = "p:thumb:";
  var MAX_EDGE = 256;
  var NONE = "-";
  function cachedThumb(collectionId) {
    try {
      const v = localStorage.getItem(PREFIX + collectionId);
      return v != null && v !== NONE ? v : null;
    } catch {
      return null;
    }
  }
  function thumbResolved(collectionId) {
    try {
      return localStorage.getItem(PREFIX + collectionId) != null;
    } catch {
      return false;
    }
  }
  function store(collectionId, value) {
    try {
      localStorage.setItem(PREFIX + collectionId, value);
    } catch {
    }
  }
  function cacheNoThumb(collectionId) {
    store(collectionId, NONE);
  }
  var MIME_PREFIX = "p:mime:";
  var NO_FILE = "\0";
  function cachedMime(collectionId) {
    try {
      const v = localStorage.getItem(MIME_PREFIX + collectionId);
      return v == null ? void 0 : v === NO_FILE ? null : v;
    } catch {
      return void 0;
    }
  }
  function cacheMime(collectionId, mimeType) {
    try {
      localStorage.setItem(MIME_PREFIX + collectionId, mimeType == null || mimeType === "" ? NO_FILE : mimeType);
    } catch {
    }
  }
  async function downscaleToAvatar(bytes2, mimeType, maxEdge = 96) {
    if (typeof createImageBitmap === "undefined" || typeof document === "undefined") return null;
    try {
      const blob = new Blob([new Uint8Array(bytes2)], { type: mimeType || "application/octet-stream" });
      const bmp = await createImageBitmap(blob);
      const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (ctx == null) {
        bmp.close?.();
        return null;
      }
      ctx.drawImage(bmp, 0, 0, w, h);
      bmp.close?.();
      const out = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.7));
      if (out == null) return null;
      return { mimeType: "image/webp", bytes: Array.from(new Uint8Array(await out.arrayBuffer())) };
    } catch {
      return null;
    }
  }
  async function makeThumb(collectionId, bytes2, mimeType) {
    if (typeof createImageBitmap === "undefined" || typeof document === "undefined") return null;
    try {
      const blob = new Blob([new Uint8Array(bytes2)], { type: mimeType || "application/octet-stream" });
      const bmp = await createImageBitmap(blob);
      const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (ctx == null) {
        bmp.close?.();
        return null;
      }
      ctx.drawImage(bmp, 0, 0, w, h);
      bmp.close?.();
      const url = canvas.toDataURL("image/webp", 0.8);
      store(collectionId, url);
      return url;
    } catch {
      return null;
    }
  }

  // src/profile.ts
  var MAX_PROFILE_SCAN = 30;
  async function publishProfile(provider2, key2, profile) {
    const pubHex = key2.toPublicKey().toString();
    const fields = {
      alias: profile.alias,
      avatarMimeType: profile.avatar?.mimeType,
      avatarBytes: profile.avatar?.bytes
    };
    const avatarLen = profile.avatar?.bytes.length ?? 0;
    const estFee = Math.ceil((350 + avatarLen) * DEFAULT_FEE_PER_KB / 1e3);
    const selected = selectFunding(await getSafeUtxos(provider2), PHARLAP_OUTPUT_SATS + estFee + 600);
    const funding = await Promise.all(
      selected.map(async (u) => ({ utxo: u, sourceTx: await provider2.getSourceTransaction(u.txId) }))
    );
    const tx = new Transaction();
    for (const f2 of funding) {
      tx.addInput({
        sourceTransaction: f2.sourceTx,
        sourceOutputIndex: f2.utxo.outputIndex,
        unlockingScriptTemplate: new P2PKH().unlock(key2)
      });
    }
    tx.addOutput({ lockingScript: buildProfileScript(pubHex, fields), satoshis: PHARLAP_OUTPUT_SATS });
    tx.addOutput({ lockingScript: new P2PKH().lock(key2.toAddress()), change: true });
    await tx.fee(new SatoshisPerKilobyte(DEFAULT_FEE_PER_KB));
    await tx.sign();
    await provider2.broadcast(tx.toHex());
    const txId = tx.id("hex");
    provider2.registerPendingTx(
      txId,
      selected.map((u) => ({ txId: u.txId, outputIndex: u.outputIndex })),
      (tx.outputs[1]?.satoshis ?? 0) > 0 ? { outputIndex: 1, satoshis: tx.outputs[1].satoshis ?? 0 } : void 0
    );
    return txId;
  }
  async function resolveProfile(provider2, ownerPubKeyHex) {
    const address2 = PublicKey.fromString(ownerPubKeyHex).toAddress();
    const heightByTx = /* @__PURE__ */ new Map();
    try {
      for (const h of await provider2.getAddressHistory(address2)) heightByTx.set(h.txId, h.blockHeight || 0);
    } catch {
      return null;
    }
    try {
      for (const txId of await provider2.getRecentTxIdsForAddress(address2)) if (!heightByTx.has(txId)) heightByTx.set(txId, 0);
    } catch {
    }
    if (heightByTx.size === 0) return null;
    const owner = ownerPubKeyHex.toLowerCase();
    const ordered = [...heightByTx.entries()].sort((a, b) => (b[1] || 1e12) - (a[1] || 1e12)).slice(0, MAX_PROFILE_SCAN);
    for (const [txId] of ordered) {
      let tx;
      try {
        tx = await provider2.getSourceTransaction(txId);
      } catch {
        continue;
      }
      for (const o of tx.outputs) {
        const p = parseProfileScript(o.lockingScript);
        if (p != null && p.ownerPubKeyHex.toLowerCase() === owner) return p.fields;
      }
    }
    return null;
  }

  // src/app.ts
  var WIF_KEY = "p:wallet:wif";
  var key;
  var pubKeyHex;
  var address;
  var provider;
  var store2;
  var nftView = "list";
  var lastInbox = [];
  var lastUpdatesFeed = null;
  var $ = (id) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`missing #${id}`);
    return el;
  };
  var val = (id) => $(id).value.trim();
  var short = (s2, n = 10) => s2.length > 2 * n ? `${s2.slice(0, n)}\u2026${s2.slice(-n)}` : s2;
  var kb = (bytes2) => bytes2 < 1024 ? `${bytes2} B` : bytes2 < 1024 * 1024 ? `${(bytes2 / 1024).toFixed(1)} KB` : `${(bytes2 / (1024 * 1024)).toFixed(1)} MB`;
  var fmtTime = (ms) => {
    try {
      return new Date(ms).toLocaleString();
    } catch {
      return "";
    }
  };
  function setStatus(msg, kind = "info") {
    const el = $("status");
    el.textContent = msg;
    el.className = `status ${kind}`;
  }
  function loadKey() {
    const wif = localStorage.getItem(WIF_KEY);
    if (wif) {
      try {
        return PrivateKey.fromWif(wif);
      } catch {
      }
    }
    const k = PrivateKey.fromRandom();
    localStorage.setItem(WIF_KEY, k.toWif());
    return k;
  }
  function useKey(k) {
    key = k;
    pubKeyHex = k.toPublicKey().toString();
    address = k.toAddress();
    provider = new WalletProvider(address);
    renderWallet();
  }
  function switchWallet(k, recover) {
    localStorage.setItem(WIF_KEY, k.toWif());
    store2.clear();
    useKey(k);
    renderTokens();
    void refreshBalance();
    if (recover) {
      setStatus("Wallet restored \u2014 recovering your purchases from chain\u2026");
      void onCheckIncoming();
    }
  }
  function renderWallet() {
    $("address").textContent = address;
    $("pubkey").textContent = pubKeyHex;
    const mine = document.getElementById("myIdenticon");
    if (mine) mine.innerHTML = avatarHtml(pubKeyHex, 22);
    $("wif").value = key.toWif();
    hideWif();
  }
  function hideWif() {
    ;
    $("wif").type = "password";
    $("btnWifShow").textContent = "\u{1F441} Show";
  }
  async function refreshBalance() {
    setStatus("Fetching balance\u2026");
    try {
      const safe = await getSafeUtxos(provider);
      const spendable = safe.reduce((s2, u) => s2 + u.satoshis, 0);
      $("balance").textContent = `${spendable} sats spendable (${safe.length} funding UTXO${safe.length === 1 ? "" : "s"})`;
      setStatus("Balance updated.", "ok");
    } catch (e) {
      setStatus(`Balance error: ${e.message}`, "error");
    }
  }
  async function readFile(input) {
    const f2 = input.files?.[0];
    if (!f2) return void 0;
    const buf = new Uint8Array(await f2.arrayBuffer());
    return { mimeType: f2.type || "application/octet-stream", fileName: f2.name, bytes: Array.from(buf) };
  }
  async function onMint() {
    const name = val("mintName");
    const count = Math.max(1, parseInt(val("mintCount") || "1", 10));
    if (!name) {
      setStatus("Enter a collection name.", "error");
      return;
    }
    setStatus("Preparing the mint transaction\u2026");
    try {
      const file = await readFile($("mintFile"));
      const result = await createCollection(provider, key, {
        tokenName: name,
        supply: count,
        mintCount: count,
        file,
        confirmSpend: (total) => confirm(
          `Mint ${count} NFT${count > 1 ? "s" : ""} in \u201C${name}\u201D${file ? ` (embedding a ${kb(file.bytes.length)} file)` : ""}?

This spends ${total.toLocaleString()} sats from your wallet (network fee + ${count} \xD7 1-sat token output${count > 1 ? "s" : ""}).

Proceed?`
        )
      });
      for (const op3 of result.tokenOutpoints) {
        store2.add({ txId: op3.txId, outputIndex: op3.outputIndex, collectionId: result.collectionId, stateData: "", collectionName: name });
      }
      renderTokens();
      setStatus(`Minted ${result.tokenOutpoints.length} NFT(s). Collection ${short(result.collectionId)} (TX1 ${short(result.tx1Id)}, TX2 ${short(result.tx2Id)}).`, "ok");
    } catch (e) {
      if (e.message === SPEND_CANCELLED) {
        setStatus("Mint cancelled \u2014 nothing was spent.");
        return;
      }
      setStatus(`Mint failed: ${e.message}`, "error");
    }
  }
  var EDITION_BOND_SATS = 2100;
  function ownTerms() {
    return {
      publisherPubKeyHash: Hash_exports.hash160(key.toPublicKey().encode(true)),
      publisherFeeSats: Math.max(0, parseInt(val("edPublisherFee") || "0", 10)),
      holderFeeSats: Math.max(0, parseInt(val("edHolderFee") || "0", 10)),
      tokenSats: EDITION_BOND_SATS
    };
  }
  function termsFromToken(t) {
    return {
      publisherPubKeyHash: utils_exports.toArray(t.publisherPubKeyHashHex ?? "", "hex"),
      publisherFeeSats: t.publisherFeeSats ?? 0,
      holderFeeSats: t.holderFeeSats ?? 0,
      tokenSats: 1
    };
  }
  function storeEdition(o, collectionId, name, terms, note) {
    store2.add({
      txId: o.txId,
      outputIndex: o.outputIndex,
      collectionId,
      stateData: "",
      collectionName: name,
      kind: "edition",
      lockHex: o.lockHex,
      publisherPubKeyHashHex: utils_exports.toHex(terms.publisherPubKeyHash),
      publisherFeeSats: terms.publisherFeeSats,
      holderFeeSats: terms.holderFeeSats,
      ...note?.text ? { sellerNote: note.text } : {},
      ...note?.bonusValue ? { bonusKind: note.bonusKind, bonusValue: note.bonusValue } : {}
    });
  }
  async function onV2Probe() {
    if (!confirm("Broadcast a tiny version-2 (Chronicle) self-send to confirm the network accepts v2 txs? Costs only the miner fee.")) return;
    setStatus("Broadcasting v2 probe\u2026");
    try {
      const txId = await broadcastV2Probe(provider, key);
      setStatus(`\u2705 v2 tx accepted by broadcast: ${short(txId)}. Confirm it on WhatsOnChain.`, "ok");
    } catch (e) {
      setStatus(`v2 probe rejected: ${e.message}`, "error");
    }
  }
  async function onMintEdition() {
    const name = val("edName");
    if (!name) {
      setStatus("Enter an edition collection name.", "error");
      return;
    }
    const count = Math.max(1, parseInt(val("edCount") || "1", 10));
    const encrypt = $("edEncrypt").checked;
    const description = val("edDescription");
    try {
      const file = await readFile($("edFile"));
      const cover = await readFile($("edCover"));
      if (encrypt && !file) {
        setStatus("Encryption needs a file \u2014 attach one or uncheck encrypt.", "error");
        return;
      }
      const terms = ownTerms();
      setStatus("Preparing the edition mint\u2026");
      const result = await createEdition(provider, key, {
        tokenName: name,
        terms,
        mintCount: count,
        file,
        encrypt,
        description,
        cover,
        confirmSpend: (total) => confirm(
          `Mint ${count} edition${count > 1 ? "s" : ""} of \u201C${name}\u201D${encrypt ? " (encrypted)" : ""}${file ? ` (embedding a ${kb(file.bytes.length)} file)` : ""}?

This spends ${total.toLocaleString()} sats from your wallet \u2014 mostly a refundable ${EDITION_BOND_SATS.toLocaleString()}-sat bond per edition (reclaimable by burning), plus the network fee.

Buyers later pay the publisher ${terms.publisherFeeSats} + holder ${terms.holderFeeSats} sats per copy.

Proceed?`
        )
      });
      for (const e of result.editions) storeEdition(e, result.collectionId, name, terms);
      renderTokens();
      setStatus(`Minted ${result.editions.length} edition(s). Collection ${short(result.collectionId)} (TX2 ${short(result.tx2Id)}).`, "ok");
    } catch (e) {
      if (e.message === SPEND_CANCELLED) {
        setStatus("Edition mint cancelled \u2014 nothing was spent.");
        return;
      }
      setStatus(`Edition mint failed: ${e.message}`, "error");
    }
  }
  async function noteToPropagate(t) {
    try {
      const p = await resolveSellerNote(provider, pubKeyHex, t.collectionId);
      if (p && (p.text || p.bonusValue)) return p;
    } catch {
    }
    if (t.sellerNote || t.bonusValue) return { text: t.sellerNote ?? "", bonusKind: t.bonusKind, bonusValue: t.bonusValue };
    return void 0;
  }
  async function onReplicate(t) {
    if (!t.lockHex) {
      setStatus("Missing edition script; cannot replicate.", "error");
      return;
    }
    const name = t.collectionName ?? "this edition";
    setStatus("Preparing the replication\u2026");
    try {
      if (parseEditionScriptV2(LockingScript.fromHex(t.lockHex)) != null) {
        const r3 = await replicateEditionV2(provider, key, {
          editionTxId: t.txId,
          editionOutputIndex: t.outputIndex,
          editionLockHex: t.lockHex,
          confirmSpend: (total) => confirm(
            `Replicate a copy of \u201C${name}\u201D?

This spends ${total.toLocaleString()} sats from your wallet (the seller\u2019s price + network fee).

Proceed?`
          )
        });
        store2.markSent(t.txId, t.outputIndex);
        storeEdition({ txId: r3.txId, outputIndex: 0, lockHex: t.lockHex }, t.collectionId, t.collectionName ?? "Edition", termsFromToken(t));
        storeEdition({ txId: r3.replicaOutpoint.txId, outputIndex: r3.replicaOutpoint.outputIndex, lockHex: r3.lockHex }, t.collectionId, t.collectionName ?? "Edition", termsFromToken(t));
        renderTokens();
        setStatus(`\u2705 v2 replicated. Tx ${short(r3.txId)} \u2014 publisher ${r3.publisherCut} + reseller ${r3.resellerCut} sats.`, "ok");
        return;
      }
      const note = await noteToPropagate(t);
      const r2 = await replicateEdition(provider, key, {
        editionTxId: t.txId,
        editionOutputIndex: t.outputIndex,
        editionLockHex: t.lockHex,
        terms: termsFromToken(t),
        note,
        confirmSpend: (total) => confirm(
          `Replicate a copy of \u201C${name}\u201D?

This spends ${total.toLocaleString()} sats from your wallet (publisher ${t.publisherFeeSats ?? 0} + holder ${t.holderFeeSats ?? 0} fees + network fee).

Proceed?`
        )
      });
      store2.markSent(t.txId, t.outputIndex);
      storeEdition(
        { txId: r2.txId, outputIndex: 0, lockHex: t.lockHex },
        t.collectionId,
        t.collectionName ?? "Edition",
        termsFromToken(t),
        t.sellerNote || t.bonusValue ? { text: t.sellerNote ?? "", bonusKind: t.bonusKind, bonusValue: t.bonusValue } : null
      );
      storeEdition(
        { txId: r2.replicaOutpoint.txId, outputIndex: r2.replicaOutpoint.outputIndex, lockHex: r2.lockHex },
        t.collectionId,
        t.collectionName ?? "Edition",
        termsFromToken(t),
        note
      );
      renderTokens();
      setStatus(`\u2705 Replicated. Tx ${short(r2.txId)} \u2014 NFT returned to holder, replica minted, fees paid.`, "ok");
    } catch (e) {
      if (e.message === SPEND_CANCELLED) {
        setStatus("Replication cancelled \u2014 nothing was spent.");
        return;
      }
      setStatus(`Replicate failed: ${e.message}`, "error");
    }
  }
  async function onTransferEdition(t) {
    const recipient = val("sendPubKey");
    if (recipient.length !== 66 && recipient.length !== 130) {
      setStatus("Enter the recipient's public key (33- or 65-byte hex) above.", "error");
      return;
    }
    if (!t.lockHex) {
      setStatus("Missing edition script; cannot transfer.", "error");
      return;
    }
    setStatus("Transferring edition (owner-signed, re-creating covenant)\u2026");
    try {
      const note = await noteToPropagate(t);
      const r2 = await transferEdition(provider, key, {
        editionTxId: t.txId,
        editionOutputIndex: t.outputIndex,
        editionLockHex: t.lockHex,
        newOwnerPubKey: utils_exports.toArray(recipient, "hex"),
        note
      });
      store2.markSent(t.txId, t.outputIndex);
      renderTokens();
      setStatus(`\u2705 Transferred. Tx ${short(r2.txId)} \u2014 covenant re-created for the new owner.`, "ok");
    } catch (e) {
      setStatus(`Transfer failed: ${e.message}`, "error");
    }
  }
  async function onBurn(t) {
    if (!t.lockHex) {
      setStatus("Missing edition script; cannot burn.", "error");
      return;
    }
    if (!confirm(
      `Burn your edition of \u201C${t.collectionName ?? "this collection"}\u201D and reclaim its ~${EDITION_BOND_SATS.toLocaleString()}-sat bond (minus a small network fee) to your wallet?

\u26A0 This DESTROYS the token permanently \u2014 it cannot be undone. Proceed?`
    )) return;
    setStatus("Burning edition (reclaiming the bond)\u2026");
    try {
      const r2 = await burnEdition(provider, key, { editionTxId: t.txId, editionOutputIndex: t.outputIndex, editionLockHex: t.lockHex });
      store2.markSent(t.txId, t.outputIndex);
      renderTokens();
      setStatus(`\u{1F525} Burned. Reclaimed ${r2.reclaimSats.toLocaleString()} sats to your wallet. Tx ${short(r2.txId)}.`, "ok");
    } catch (e) {
      setStatus(`Burn failed: ${e.message}`, "error");
    }
  }
  async function onSend(txId, outputIndex) {
    const recipient = val("sendPubKey");
    if (recipient.length !== 66 && recipient.length !== 130) {
      setStatus("Enter the recipient's public key (33- or 65-byte hex).", "error");
      return;
    }
    setStatus("Sending NFT\u2026");
    try {
      const result = await createTransfer(provider, key, { tokenTxId: txId, tokenOutputIndex: outputIndex, recipientPubKeyHex: recipient });
      store2.markSent(txId, outputIndex);
      renderTokens();
      setStatus(`Sent. Transfer tx ${short(result.txId)} (recipient notified at output ${result.notifyVout}).`, "ok");
    } catch (e) {
      setStatus(`Send failed: ${e.message}`, "error");
    }
  }
  async function onSendMessage() {
    const to = val("msgTo");
    if (to.length !== 66 && to.length !== 130) {
      setStatus("Enter the recipient's public key (33- or 65-byte hex).", "error");
      return;
    }
    const text = $("msgText").value;
    const encrypt = $("msgEncrypt").checked;
    const file = await readFile($("msgFile"));
    const parts = [];
    if (text.trim()) parts.push({ kind: "text", text });
    if (file) parts.push({ kind: "file", mimeType: file.mimeType, fileName: file.fileName, bytes: file.bytes });
    if (parts.length === 0) {
      setStatus("Write a message or attach a file first.", "error");
      return;
    }
    setStatus(`Sending ${encrypt ? "encrypted" : "public"} message\u2026`);
    try {
      const r2 = await sendMessage(provider, key, { toPubKeyHex: to, parts, encrypt, senderAlias: getMyAlias() });
      $("msgText").value = "";
      setStatus(`Message sent. Tx ${short(r2.txId)}.`, "ok");
    } catch (e) {
      setStatus(`Send message failed: ${e.message}`, "error");
    }
  }
  async function onPublishProfile() {
    const alias = getMyAlias();
    const file = await readFile($("profileAvatar"));
    let avatar;
    if (file != null) {
      if (!file.mimeType.startsWith("image/")) {
        setStatus("Avatar must be an image.", "error");
        return;
      }
      const small = await downscaleToAvatar(file.bytes, file.mimeType);
      if (small == null) {
        setStatus("Could not process that image (need a browser that encodes WebP).", "error");
        return;
      }
      avatar = small;
    }
    if (alias === "" && avatar == null) {
      setStatus("Set an alias (above) or choose an avatar image first.", "error");
      return;
    }
    if (!confirm(
      `Publish your profile on-chain${avatar ? ` (a ${kb(avatar.bytes.length)} avatar)` : ""}${alias ? ` as @${alias}` : ""}?

It's posted to your own address and spends a small network fee. Proceed?`
    )) return;
    setStatus("Publishing your profile\u2026");
    try {
      const txId = await publishProfile(provider, key, { alias: alias || void 0, avatar });
      if (avatar != null) {
        setAvatar(myPubKeyLc(), bytesToDataUrl(avatar.mimeType, avatar.bytes));
        renderWallet();
      }
      ;
      $("profileAvatar").value = "";
      setStatus(`\u2705 Profile published. Tx ${short(txId)} \u2014 others now resolve your @name + avatar by your key.`, "ok");
    } catch (e) {
      setStatus(`Publish profile failed: ${e.message}`, "error");
    }
  }
  async function onCheckMessages() {
    setStatus("Checking for messages\u2026");
    try {
      const msgs = await scanIncomingMessages(provider, key);
      applyLatestAliases(msgs.map((m) => ({ pk: m.senderPubKeyHex, alias: m.senderAlias })));
      renderInbox(msgs);
      resolveAvatarsThen(msgs.map((m) => m.senderPubKeyHex), () => renderInbox(lastInbox));
      setStatus(`Inbox: ${msgs.length} message(s).`, "ok");
    } catch (e) {
      setStatus(`Check messages failed: ${e.message}`, "error");
    }
  }
  function renderInbox(msgs) {
    lastInbox = msgs;
    const host = $("inbox");
    if (msgs.length === 0) {
      host.innerHTML = '<p class="muted">No messages found.</p>';
      return;
    }
    host.innerHTML = "";
    for (const m of msgs) {
      const card2 = document.createElement("div");
      card2.className = "token msg";
      const textPart = m.parts.find((p) => p.kind === "text");
      const hasKey = m.parts.some((p) => p.kind === "key");
      const filePart = m.parts.find((p) => p.kind === "file");
      card2.innerHTML = `
      <div class="mono">from ${nameChip(m.senderPubKeyHex, { save: true })} ${m.encrypted ? "\u{1F512} encrypted" : "\u{1F310} public"}</div>
      ${m.sentAt ? `<div class="muted" style="font-size:11px" title="Sender's clock (self-asserted)">\u{1F552} ${escapeHtml(fmtTime(m.sentAt))}${m.height ? "" : " \xB7 pending"}</div>` : m.height ? "" : '<div class="muted" style="font-size:11px">pending</div>'}
      ${textPart && textPart.kind === "text" ? `<div class="state">${escapeHtml(textPart.text)}</div>` : ""}
      ${hasKey ? '<div class="muted" style="font-size:12px">\u{1F511} carries a content key</div>' : ""}
    `;
      const actions = document.createElement("div");
      actions.className = "actions";
      const reply = document.createElement("button");
      reply.textContent = "\u21A9 Reply";
      reply.className = "secondary";
      reply.onclick = () => onReply(m);
      actions.append(reply);
      if (filePart && filePart.kind === "file") {
        const btn = document.createElement("button");
        btn.textContent = `View ${filePart.fileName}`;
        btn.className = "secondary";
        btn.onclick = () => showFile("Message attachment", { mimeType: filePart.mimeType, fileName: filePart.fileName, fileBytes: filePart.bytes }, true);
        actions.append(btn);
      }
      card2.append(actions);
      host.append(card2);
    }
  }
  function onReply(m) {
    ;
    $("msgTo").value = m.senderPubKeyHex;
    $("msgEncrypt").checked = m.encrypted;
    updateMsgToName();
    $("msgTo").scrollIntoView({ behavior: "smooth", block: "start" });
    $("msgText").focus();
    const who = displayName(m.senderPubKeyHex);
    setStatus(`Replying to ${who.name}.`);
  }
  var nameCache = /* @__PURE__ */ new Map();
  var latestBroadcast = /* @__PURE__ */ new Map();
  async function resolveCollectionName(tx1RefHex) {
    const cached = nameCache.get(tx1RefHex);
    if (cached != null) return cached;
    let name = "Edition";
    try {
      const tx1 = await provider.getSourceTransaction(tx1RefHex);
      for (const o of tx1.outputs) {
        const t = parseTemplateScript(o.lockingScript);
        if (t && t.fields.tokenName) {
          name = t.fields.tokenName;
          break;
        }
      }
    } catch {
    }
    nameCache.set(tx1RefHex, name);
    return name;
  }
  async function onCheckIncoming() {
    setStatus("Scanning for incoming NFTs and editions\u2026");
    let added = 0;
    let edAdded = 0;
    const errors = [];
    try {
      const incoming = await scanIncoming(provider, pubKeyHex);
      for (const t of incoming) {
        const tx = await provider.getSourceTransaction(t.txId);
        const v = await verifyTokenLineage(tx, t.outputIndex, { getRawTransaction: (id) => provider.getSourceTransaction(id) });
        if (!v.valid) continue;
        if (store2.add({ txId: t.txId, outputIndex: t.outputIndex, collectionId: t.fields.tx1Ref, stateData: t.fields.stateData })) added++;
      }
    } catch (e) {
      errors.push(`tokens: ${e.message}`);
    }
    try {
      const editions = await scanIncomingEditions(provider, pubKeyHex);
      for (const e of editions) {
        const name = await resolveCollectionName(e.tx1RefHex);
        if (store2.add({
          txId: e.txId,
          outputIndex: e.outputIndex,
          collectionId: e.tx1RefHex,
          stateData: "",
          collectionName: name,
          kind: "edition",
          lockHex: e.lockHex,
          publisherPubKeyHashHex: utils_exports.toHex(e.terms.publisherPubKeyHash),
          publisherFeeSats: e.terms.publisherFeeSats,
          holderFeeSats: e.terms.holderFeeSats,
          ...e.sellerNote?.text ? { sellerNote: e.sellerNote.text } : {},
          ...e.sellerNote?.bonusValue ? { bonusKind: e.sellerNote.bonusKind, bonusValue: e.sellerNote.bonusValue } : {},
          ...e.height ? { heightHint: e.height } : {}
        })) edAdded++;
        else store2.setCollectionName(e.txId, e.outputIndex, name);
      }
    } catch (e) {
      errors.push(`editions: ${e.message}`);
    }
    renderTokens();
    if (errors.length > 0 && added === 0 && edAdded === 0) {
      setStatus(`Scan failed \u2014 ${errors.join("; ")}`, "error");
    } else {
      setStatus(`Scan complete: ${added} NFT(s) + ${edAdded} edition(s) new.${errors.length ? " (" + errors.join("; ") + ")" : ""}`, "ok");
    }
  }
  async function onVerify(txId, outputIndex) {
    setStatus("Verifying NFT lineage\u2026");
    try {
      const tx = await provider.getSourceTransaction(txId);
      const ed = parseEditionAny(tx.outputs[outputIndex]?.lockingScript);
      if (ed) {
        const econ = ed.isV2 ? `publisher ${(ed.terms.pBps / 100).toFixed(2)}% \xB7 price ${ed.priceSats} sats` : `fees ${ed.terms.publisherFeeSats}/${ed.terms.holderFeeSats} sats`;
        setStatus(`\u2705 Valid ${ed.isV2 ? "v2 " : ""}edition covenant \u2014 collection ${short(ed.tx1RefHex)}, owner ${short(ed.ownerPubKeyHex)}, ${econ} (structure verified).`, "ok");
        return;
      }
      const deps = { getRawTransaction: (id) => provider.getSourceTransaction(id) };
      const v = await verifyTokenLineage(tx, outputIndex, deps);
      let name = "";
      try {
        const tx1 = await provider.getSourceTransaction(v.collectionId ?? "");
        for (const o of tx1.outputs) {
          const tmpl = parseTemplateScript(o.lockingScript);
          if (tmpl) {
            name = tmpl.fields.tokenName;
            break;
          }
        }
      } catch {
      }
      setStatus(`${v.valid ? "\u2705" : "\u274C"} ${v.reason}${name ? ` \u2014 collection "${name}"` : ""}`, v.valid ? "ok" : "error");
    } catch (e) {
      setStatus(`Verify failed: ${e.message}`, "error");
    }
  }
  var viewerUrl = null;
  async function onView(collectionId, collectionName) {
    setStatus("Loading the embedded file from the collection\u2026");
    try {
      const tx1 = await provider.getSourceTransaction(collectionId);
      let file = null;
      let template;
      for (const o of tx1.outputs) {
        const f2 = parseFileScript(o.lockingScript);
        if (f2) file = f2.fields;
        const t = parseTemplateScript(o.lockingScript);
        if (t) template = t.fields;
      }
      if (!file) {
        setStatus(`"${collectionName}" has no embedded file.`, "info");
        return;
      }
      const rules = template != null ? decodeTokenRules(template.tokenRules) : null;
      const encrypted = rules?.isEncrypted ?? false;
      const ciphertextOk = encrypted && template?.fileHash === utils_exports.toHex(Hash_exports.sha256(file.fileBytes));
      let bytes2 = file.fileBytes;
      if (encrypted) {
        if (template?.wrappedKey == null || template?.keySalt == null) {
          setStatus("Encrypted collection is missing its wrapped key \u2014 cannot decrypt.", "error");
          return;
        }
        const K2 = unwrapContentKey(template.wrappedKey, template.keySalt);
        if (K2 == null) {
          setStatus("Could not unwrap the content key.", "error");
          return;
        }
        try {
          bytes2 = decryptContent(bytes2, K2);
        } catch {
          setStatus("Decryption failed (wrong key or corrupt ciphertext).", "error");
          return;
        }
      }
      if (rules?.isCompressed) {
        try {
          bytes2 = await decompress(bytes2);
        } catch {
          setStatus("Decompression failed (corrupt data).", "error");
          return;
        }
      }
      const verified = encrypted ? ciphertextOk : template?.fileHash === utils_exports.toHex(Hash_exports.sha256(bytes2));
      const msg = encrypted ? verified ? "\u{1F513} Decrypted \u2014 ciphertext matches the on-chain commitment \u2713" : "\u26A0 Decrypted, but the ciphertext hash does NOT match the collection!" : verified ? "\u2713 Verified exact replica \u2014 SHA-256 of the content matches the on-chain commitment (timestamped on mint)" : "\u26A0 File loaded, but its hash does NOT match the on-chain commitment!";
      showFile(collectionName, { mimeType: file.mimeType, fileName: file.fileName, fileBytes: bytes2 }, verified, msg);
      setStatus(msg, verified ? "ok" : "error");
    } catch (e) {
      setStatus(`View failed: ${e.message}`, "error");
    }
  }
  function showFile(title, file, verified, note) {
    const content = $("viewerContent");
    if (viewerUrl) {
      URL.revokeObjectURL(viewerUrl);
      viewerUrl = null;
    }
    viewerUrl = URL.createObjectURL(new Blob([new Uint8Array(file.fileBytes)], { type: file.mimeType }));
    $("viewerTitle").textContent = `${title} \u2014 ${file.fileName} \xB7 ${file.mimeType} \xB7 ${file.fileBytes.length} bytes`;
    const banner = $("viewerProvenance");
    if (note) {
      banner.textContent = note;
      banner.className = `viewer-banner ${verified ? "ok" : "error"}`;
      banner.style.display = "block";
    } else {
      banner.style.display = "none";
    }
    content.innerHTML = "";
    if (file.mimeType.startsWith("image/")) {
      const img = document.createElement("img");
      img.src = viewerUrl;
      img.className = "viewer-img";
      content.append(img);
    } else if (file.mimeType.startsWith("text/") || file.mimeType === "application/json") {
      const pre = document.createElement("pre");
      pre.className = "viewer-pre";
      pre.textContent = new TextDecoder().decode(new Uint8Array(file.fileBytes));
      content.append(pre);
    } else {
      const a = document.createElement("a");
      a.href = viewerUrl;
      a.download = file.fileName;
      a.textContent = `Download ${file.fileName}`;
      a.className = "viewer-dl";
      content.append(a);
    }
    $("viewer").style.display = "flex";
  }
  function closeViewer() {
    $("viewer").style.display = "none";
    if (viewerUrl) {
      URL.revokeObjectURL(viewerUrl);
      viewerUrl = null;
    }
    $("viewerContent").innerHTML = "";
  }
  var CATS = [
    { key: "image", label: "Images", icon: "\u{1F5BC}\uFE0F" },
    { key: "audio", label: "Audio", icon: "\u{1F3B5}" },
    { key: "video", label: "Video", icon: "\u{1F3AC}" },
    { key: "document", label: "Documents", icon: "\u{1F4C4}" },
    { key: "text", label: "Text", icon: "\u{1F4DD}" },
    { key: "archive", label: "Archives", icon: "\u{1F5DC}\uFE0F" },
    { key: "other", label: "Other", icon: "\u{1F3B4}" }
  ];
  function mimeCategory(mime) {
    if (mime == null || mime === "") return "other";
    const m = mime.toLowerCase();
    if (m.startsWith("image/")) return "image";
    if (m.startsWith("audio/")) return "audio";
    if (m.startsWith("video/")) return "video";
    if (m.startsWith("text/")) return "text";
    if (m === "application/pdf" || m.includes("msword") || m.includes("officedocument") || m.includes("ms-excel") || m.includes("ms-powerpoint") || m.includes("opendocument") || m === "application/rtf" || m === "application/epub+zip") return "document";
    if (m === "application/json" || m === "application/xml" || m.endsWith("+xml")) return "text";
    if (m === "application/zip" || m === "application/gzip" || m === "application/x-tar" || m.includes("compressed") || m.includes("7z") || m.includes("rar") || m === "application/x-bzip2") return "archive";
    return "other";
  }
  function renderTokens(skipWarm = false) {
    const host = $("tokens");
    const active = [...store2.active()].sort((a, b) => {
      const ha = a.heightHint ?? Infinity;
      const hb = b.heightHint ?? Infinity;
      if (ha !== hb) return hb - ha;
      return (b.addedAt ?? "").localeCompare(a.addedAt ?? "");
    });
    if (active.length === 0) {
      host.innerHTML = '<p class="muted">No NFTs yet. Publish a collection or Check Incoming.</p>';
      return;
    }
    const myHash = utils_exports.toHex(Hash_exports.hash160(key.toPublicKey().encode(true)));
    const groups = /* @__PURE__ */ new Map();
    for (const t of active) {
      const g = groups.get(t.collectionId);
      if (g != null) g.push(t);
      else groups.set(t.collectionId, [t]);
    }
    const buckets = /* @__PURE__ */ new Map();
    let anyPending = false;
    for (const [collectionId, copies] of groups) {
      const mime = cachedMime(collectionId);
      const cat = mime === void 0 ? skipWarm ? "other" : (anyPending = true, "pending") : mimeCategory(mime);
      const arr = buckets.get(cat);
      if (arr != null) arr.push([collectionId, copies]);
      else buckets.set(cat, [[collectionId, copies]]);
    }
    host.innerHTML = `<p class="muted" style="font-size:12px;margin:0 0 8px">${active.length} held \u2014 newest first</p>`;
    const single = CATS.filter((c) => buckets.get(c.key)?.length).length <= 1 && !anyPending;
    for (const c of CATS) {
      const items = buckets.get(c.key);
      if (items == null || items.length === 0) continue;
      if (single) host.append(sectionBody(items, myHash));
      else host.append(sectionEl(`${c.icon} ${c.label}`, items, myHash));
    }
    const pending = buckets.get("pending");
    if (pending?.length) host.append(sectionEl("\u23F3 Identifying type\u2026", pending, myHash));
    if (anyPending) void warmAndRerender([...groups.keys()]);
  }
  function card(collectionId, copies, myHash) {
    return copies.length === 1 ? singleCard(copies[0], myHash) : groupCard(collectionId, copies, myHash);
  }
  function sectionBody(items, myHash) {
    const wrap = document.createElement("div");
    if (nftView === "grid") {
      wrap.className = "token-grid";
      for (const [cid, copies] of items) wrap.append(tileEl(cid, copies, myHash));
    } else {
      for (const [cid, copies] of items) wrap.append(card(cid, copies, myHash));
    }
    return wrap;
  }
  function sectionEl(label, items, myHash) {
    const sec = document.createElement("div");
    sec.className = "token-section";
    const head = document.createElement("div");
    head.className = "token-section-head";
    head.innerHTML = `<span class="chev">\u25BE</span> <span class="token-section-label">${label}</span> <span class="count">${items.length}</span>`;
    const bodyEl = sectionBody(items, myHash);
    bodyEl.classList.add("token-section-body");
    head.onclick = () => {
      bodyEl.hidden = !bodyEl.hidden;
      head.querySelector(".chev").textContent = bodyEl.hidden ? "\u25B8" : "\u25BE";
    };
    sec.append(head, bodyEl);
    return sec;
  }
  function tileEl(collectionId, copies, myHash) {
    const t0 = copies[0];
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "token-tile";
    const thumb = document.createElement("div");
    thumb.className = "token-tile-thumb";
    thumb.innerHTML = '<div class="token-thumb-ph">\u{1F3B4}</div>';
    void fillCardThumb(thumb, collectionId);
    const cap = document.createElement("div");
    cap.className = "token-tile-cap";
    cap.innerHTML = `<span class="token-tile-name">${escapeHtml(t0.collectionName ?? "Collection")}</span>${copies.length > 1 ? `<span class="count">\xD7${copies.length}</span>` : t0.kind === "edition" ? '<span class="count">edition</span>' : ""}`;
    tile.append(thumb, cap);
    tile.onclick = () => openTokenDetail(collectionId, copies, myHash);
    return tile;
  }
  function openTokenDetail(collectionId, copies, myHash) {
    const body = $("tokenModalBody");
    body.innerHTML = "";
    body.append(copies.length === 1 ? singleCard(copies[0], myHash) : groupCard(collectionId, copies, myHash, true));
    $("tokenModal").style.display = "flex";
  }
  function closeTokenModal() {
    $("tokenModal").style.display = "none";
    $("tokenModalBody").innerHTML = "";
  }
  function setNftView(v) {
    if (nftView === v) return;
    nftView = v;
    try {
      localStorage.setItem("p:nftview", v);
    } catch {
    }
    updateViewToggle();
    renderTokens();
  }
  function updateViewToggle() {
    $("btnViewList").classList.toggle("active", nftView === "list");
    $("btnViewGrid").classList.toggle("active", nftView === "grid");
  }
  async function warmAndRerender(collectionIds) {
    await Promise.all(collectionIds.map(ensureCollectionMeta));
    renderTokens(true);
  }
  function tokenThumbEl(collectionId) {
    const thumb = document.createElement("div");
    thumb.className = "token-thumb";
    thumb.innerHTML = '<div class="token-thumb-ph">\u{1F3B4}</div>';
    void fillCardThumb(thumb, collectionId);
    return thumb;
  }
  function tokenExtrasHtml(t) {
    const stateText = t.stateData && t.stateData !== "00" ? safeUtf8(t.stateData) : "";
    const latest = latestBroadcast.get(t.collectionId);
    return `${stateText ? `<div class="state">state: ${escapeHtml(stateText)}</div>` : ""}${t.sellerNote ? `<div class="state" style="color:var(--accent2)">\u{1F4DD} ${escapeHtml(t.sellerNote)}</div>` : ""}${t.bonusValue ? t.bonusKind === "link" ? `<div class="state">\u{1F381} <a href="${escapeHtml(t.bonusValue)}" target="_blank" rel="noopener" class="bonus-claim">Claim your bonus \u2197</a></div>` : `<div class="state">\u{1F381} Bonus code: <span class="mono">${escapeHtml(t.bonusValue)}</span></div>` : ""}${latest ? `<div class="state" style="color:var(--accent)">\u{1F4E3} ${escapeHtml(latest.text)}</div>` : ""}`;
  }
  function tokenActions(t, myHash) {
    const isEdition = t.kind === "edition";
    const iAmPublisher = t.publisherPubKeyHashHex != null && t.publisherPubKeyHashHex === myHash;
    const verify2 = document.createElement("button");
    verify2.textContent = "Verify";
    verify2.className = "secondary";
    verify2.onclick = () => void onVerify(t.txId, t.outputIndex);
    const actions = document.createElement("div");
    actions.className = "actions";
    if (isEdition) {
      const replicate = document.createElement("button");
      replicate.textContent = "Replicate";
      replicate.onclick = () => void onReplicate(t);
      const xfer = document.createElement("button");
      xfer.textContent = "Transfer";
      xfer.className = "secondary";
      xfer.onclick = () => void onTransferEdition(t);
      const view = document.createElement("button");
      view.textContent = "View";
      view.className = "secondary";
      view.onclick = () => void onView(t.collectionId, t.collectionName ?? "Edition");
      const sales = document.createElement("button");
      sales.textContent = "Sales page";
      sales.className = "secondary";
      sales.onclick = () => onOpenSalesPage(t);
      actions.append(replicate, xfer, view, sales, verify2);
      if (t.lockHex != null && editionSupportsBurn(utils_exports.toArray(t.lockHex, "hex"))) {
        const burn = document.createElement("button");
        burn.textContent = "\u{1F525} Burn";
        burn.className = "secondary";
        burn.onclick = () => void onBurn(t);
        actions.append(burn);
      }
      if (iAmPublisher) {
        const bc = document.createElement("button");
        bc.textContent = "\u{1F4E3} Broadcast";
        bc.className = "secondary";
        bc.onclick = () => void onBroadcast(t);
        const gift = document.createElement("button");
        gift.textContent = "\u{1F381} Gift";
        gift.className = "secondary";
        gift.onclick = () => void onGiftCopies(t);
        actions.append(bc, gift);
      }
    } else {
      const send = document.createElement("button");
      send.textContent = "Send";
      send.onclick = () => void onSend(t.txId, t.outputIndex);
      const view = document.createElement("button");
      view.textContent = "View";
      view.className = "secondary";
      view.onclick = () => void onView(t.collectionId, t.collectionName ?? "Collection");
      actions.append(send, verify2, view);
    }
    return actions;
  }
  function singleCard(t, myHash) {
    const card2 = document.createElement("div");
    card2.className = "token";
    const body = document.createElement("div");
    body.className = "token-body";
    const isEdition = t.kind === "edition";
    body.innerHTML = `
    <div class="token-name">${escapeHtml(t.collectionName ?? "Collection")}${isEdition ? ' <span class="badge">edition</span>' : ""}</div>
    <div class="mono token-ids">collection <span class="copy-id" data-copy="${t.collectionId}" title="${t.collectionId} \u2014 click to copy">${short(t.collectionId)}</span> \xB7 utxo <span class="copy-id" data-copy="${t.txId}" title="${t.txId} \u2014 click to copy">${short(t.txId)}</span>:${t.outputIndex}</div>
    ${tokenExtrasHtml(t)}`;
    body.append(tokenActions(t, myHash));
    card2.append(tokenThumbEl(t.collectionId), body);
    return card2;
  }
  function groupCard(collectionId, copies, myHash, startOpen = false) {
    const t0 = copies[0];
    const isEdition = t0.kind === "edition";
    const card2 = document.createElement("div");
    card2.className = "token token-group";
    if (startOpen) card2.classList.add("open");
    const head = document.createElement("div");
    head.className = "token-group-head";
    const headBody = document.createElement("div");
    headBody.className = "token-body";
    headBody.innerHTML = `
    <div class="token-name">${escapeHtml(t0.collectionName ?? "Collection")}${isEdition ? ' <span class="badge">edition</span>' : ""} <span class="count">\xD7${copies.length}</span></div>
    <div class="mono token-ids">collection <span class="copy-id" data-copy="${collectionId}" title="${collectionId} \u2014 click to copy">${short(collectionId)}</span> \xB7 ${copies.length} copies held</div>`;
    const chev = document.createElement("span");
    chev.className = "chev";
    chev.textContent = startOpen ? "\u25BE" : "\u25B8";
    head.append(tokenThumbEl(collectionId), headBody, chev);
    const items = document.createElement("div");
    items.className = "token-group-items";
    items.hidden = !startOpen;
    for (const t of copies) {
      const row = document.createElement("div");
      row.className = "token-copy";
      row.innerHTML = `<div class="mono token-ids">utxo <span class="copy-id" data-copy="${t.txId}" title="${t.txId} \u2014 click to copy">${short(t.txId)}</span>:${t.outputIndex}</div>${tokenExtrasHtml(t)}`;
      row.append(tokenActions(t, myHash));
      items.append(row);
    }
    head.onclick = (e) => {
      if (e.target.closest(".copy-id") != null) return;
      items.hidden = !items.hidden;
      chev.textContent = items.hidden ? "\u25B8" : "\u25BE";
      card2.classList.toggle("open", !items.hidden);
    };
    card2.append(head, items);
    return card2;
  }
  var metaInFlight = /* @__PURE__ */ new Map();
  async function fillCardThumb(thumbEl, collectionId) {
    const cached = cachedThumb(collectionId);
    const url = cached != null ? cached : (await ensureCollectionMeta(collectionId), cachedThumb(collectionId));
    if (url == null) return;
    const img = document.createElement("img");
    img.className = "token-thumb-img";
    img.loading = "lazy";
    img.src = url;
    thumbEl.innerHTML = "";
    thumbEl.append(img);
  }
  async function ensureCollectionMeta(collectionId) {
    if (thumbResolved(collectionId) && cachedMime(collectionId) !== void 0) return;
    let p = metaInFlight.get(collectionId);
    if (p == null) {
      p = fetchCollectionMeta(collectionId);
      metaInFlight.set(collectionId, p);
    }
    try {
      await p;
    } finally {
      metaInFlight.delete(collectionId);
    }
  }
  async function fetchCollectionMeta(collectionId) {
    try {
      const tx1 = await provider.getSourceTransaction(collectionId);
      let coverBytes;
      let coverMime = "application/octet-stream";
      let file = null;
      let template;
      for (const o of tx1.outputs) {
        const s2 = parseStorefrontScript(o.lockingScript);
        if (s2?.fields.coverBytes?.length) {
          coverBytes = s2.fields.coverBytes;
          coverMime = s2.fields.coverMimeType ?? coverMime;
        }
        const f2 = parseFileScript(o.lockingScript);
        if (f2) file = f2.fields;
        const t = parseTemplateScript(o.lockingScript);
        if (t) template = t.fields;
      }
      cacheMime(collectionId, file?.mimeType ?? null);
      if (coverBytes?.length) {
        if (await makeThumb(collectionId, coverBytes, coverMime) != null) return;
      }
      const rules = template != null ? decodeTokenRules(template.tokenRules) : null;
      if (file != null && !rules?.isEncrypted && file.mimeType.startsWith("image/")) {
        let bytes2 = file.fileBytes;
        if (rules?.isCompressed) {
          try {
            bytes2 = await decompress(bytes2);
          } catch {
          }
        }
        if (await makeThumb(collectionId, bytes2, file.mimeType) != null) return;
      }
      cacheNoThumb(collectionId);
    } catch {
    }
  }
  function safeUtf8(hex) {
    try {
      return utils_exports.toUTF8(utils_exports.toArray(hex, "hex"));
    } catch {
      return hex;
    }
  }
  function onCopyClick(e) {
    const el = e.target?.closest("[data-copy]");
    if (el == null) return;
    const value = el.dataset.copy ?? "";
    if (value === "") return;
    void navigator.clipboard?.writeText(value);
    toast("Copied to clipboard");
  }
  var toastTimer;
  function toast(message) {
    let el = document.getElementById("toast");
    if (el == null) {
      el = document.createElement("div");
      el.id = "toast";
      document.body.append(el);
    }
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el?.classList.remove("show"), 1400);
  }
  function escapeHtml(s2) {
    return s2.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  var contacts = {};
  var seenAliases = {};
  var pinned = {};
  function persist(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
    }
  }
  function loadAliases() {
    try {
      contacts = JSON.parse(localStorage.getItem("p:contacts") ?? "{}");
    } catch {
      contacts = {};
    }
    try {
      seenAliases = JSON.parse(localStorage.getItem("p:aliases") ?? "{}");
    } catch {
      seenAliases = {};
    }
    try {
      pinned = JSON.parse(localStorage.getItem("p:pinned") ?? "{}");
    } catch {
      pinned = {};
    }
    try {
      avatars = JSON.parse(localStorage.getItem("p:avatars") ?? "{}");
    } catch {
      avatars = {};
    }
  }
  function getMyAlias() {
    try {
      return (localStorage.getItem("p:myalias") ?? "").trim();
    } catch {
      return "";
    }
  }
  function setMyAlias(a) {
    try {
      localStorage.setItem("p:myalias", a);
    } catch {
    }
  }
  function rememberAlias(pubKeyHex2, alias) {
    if (alias === "") return;
    const k = pubKeyHex2.toLowerCase();
    if (contacts[k] != null) {
      if (!pinned[k] && contacts[k] !== alias) {
        contacts[k] = alias;
        persist("p:contacts", contacts);
      }
      return;
    }
    if (seenAliases[k] === alias) return;
    seenAliases[k] = alias;
    persist("p:aliases", seenAliases);
  }
  function applyLatestAliases(items) {
    const latest = /* @__PURE__ */ new Map();
    for (const it of items) {
      const k = it.pk.toLowerCase();
      if (it.alias != null && it.alias !== "" && !latest.has(k)) latest.set(k, it.alias);
    }
    for (const [pk, alias] of latest) rememberAlias(pk, alias);
  }
  function saveContact(pubKeyHex2, alias, customLabel = false) {
    const k = pubKeyHex2.toLowerCase();
    contacts[k] = alias;
    if (customLabel) pinned[k] = 1;
    else delete pinned[k];
    delete seenAliases[k];
    persist("p:contacts", contacts);
    persist("p:pinned", pinned);
    persist("p:aliases", seenAliases);
  }
  function removeContact(pubKeyHex2) {
    const k = pubKeyHex2.toLowerCase();
    delete contacts[k];
    delete pinned[k];
    persist("p:contacts", contacts);
    persist("p:pinned", pinned);
  }
  function ignoreSeen(pubKeyHex2) {
    delete seenAliases[pubKeyHex2.toLowerCase()];
    try {
      localStorage.setItem("p:aliases", JSON.stringify(seenAliases));
    } catch {
    }
  }
  function refreshNameSurfaces() {
    renderInbox(lastInbox);
    if (lastUpdatesFeed != null) renderUpdatesFeed(lastUpdatesFeed);
    renderTokens();
    updateMsgToName();
  }
  function displayName(pubKeyHex2) {
    const k = pubKeyHex2.toLowerCase();
    if (k === myPubKeyLc()) {
      const a = getMyAlias();
      return a ? { name: "@" + a, verified: true, isMe: true, alias: a } : { name: short(pubKeyHex2), verified: true, isMe: true };
    }
    if (contacts[k] != null) return { name: "@" + contacts[k], verified: true, isMe: false, alias: contacts[k] };
    if (seenAliases[k] != null) return { name: "@" + seenAliases[k], verified: false, isMe: false, alias: seenAliases[k] };
    return { name: short(pubKeyHex2), verified: true, isMe: false };
  }
  function myPubKeyLc() {
    try {
      return pubKeyHex.toLowerCase();
    } catch {
      return "";
    }
  }
  function keyHue(pubKeyHex2) {
    const h = Hash_exports.sha256(utils_exports.toArray(pubKeyHex2.toLowerCase(), "hex"));
    return (h[0] << 8 | h[1]) % 360;
  }
  function identiconSvg(pubKeyHex2, px = 18) {
    const h = Hash_exports.sha256(utils_exports.toArray(pubKeyHex2.toLowerCase(), "hex"));
    const hue = keyHue(pubKeyHex2);
    const fg = `hsl(${hue},62%,58%)`;
    const bg = `hsl(${hue},22%,20%)`;
    const N2 = 5;
    let cells = "";
    for (let y = 0; y < N2; y++) {
      for (let x = 0; x < 3; x++) {
        if ((h[2 + y * 3 + x] & 1) === 0) continue;
        cells += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
        if (x < 2) cells += `<rect x="${N2 - 1 - x}" y="${y}" width="1" height="1"/>`;
      }
    }
    return `<svg class="identicon" width="${px}" height="${px}" viewBox="0 0 ${N2} ${N2}" aria-hidden="true"><rect width="${N2}" height="${N2}" fill="${bg}"/><g fill="${fg}">${cells}</g></svg>`;
  }
  var NO_AVATAR = "-";
  var avatars = {};
  function cachedAvatar(pubKeyHex2) {
    const a = avatars[pubKeyHex2.toLowerCase()];
    return a != null && a !== NO_AVATAR ? a : null;
  }
  function setAvatar(pubKeyHex2, value) {
    avatars[pubKeyHex2.toLowerCase()] = value;
    try {
      localStorage.setItem("p:avatars", JSON.stringify(avatars));
    } catch {
    }
  }
  function avatarHtml(pubKeyHex2, px = 18) {
    const a = cachedAvatar(pubKeyHex2);
    if (a == null) return identiconSvg(pubKeyHex2, px);
    return `<img class="avatar identicon" src="${a}" width="${px}" height="${px}" alt="" style="border:1.5px solid hsl(${keyHue(pubKeyHex2)},62%,58%)" />`;
  }
  function nameChip(pubKeyHex2, opts = {}) {
    const info = displayName(pubKeyHex2);
    const ico = avatarHtml(pubKeyHex2);
    const chip = `<span class="copy-id" data-copy="${pubKeyHex2}" title="${pubKeyHex2} \u2014 click to copy">${escapeHtml(info.name)}</span>`;
    if (info.verified) return ico + chip;
    const warn = ` <span class="unverified" title="Self-claimed name \u2014 verify the key on hover before trusting it">\u26A0 unverified</span>`;
    const save = opts.save ? ` <button class="alias-save" data-pk="${pubKeyHex2}" data-alias="${escapeHtml(info.alias ?? "")}">save</button>` : "";
    return ico + chip + warn + save;
  }
  function bytesToDataUrl(mime, bytes2) {
    let bin = "";
    for (let i = 0; i < bytes2.length; i += 32768) bin += String.fromCharCode(...bytes2.slice(i, i + 32768));
    return `data:${mime || "image/webp"};base64,${btoa(bin)}`;
  }
  var avatarInFlight = /* @__PURE__ */ new Map();
  var profileChecked = /* @__PURE__ */ new Set();
  async function ensureAvatar(pubKeyHex2) {
    const k = pubKeyHex2.toLowerCase();
    if (profileChecked.has(k)) return false;
    profileChecked.add(k);
    let p = avatarInFlight.get(k);
    if (p == null) {
      p = fetchProfileInto(k);
      avatarInFlight.set(k, p);
    }
    try {
      return await p;
    } finally {
      avatarInFlight.delete(k);
    }
  }
  async function fetchProfileInto(k) {
    try {
      const prof = await resolveProfile(provider, k);
      const newAvatar = prof?.avatarBytes != null && prof.avatarBytes.length > 0 ? bytesToDataUrl(prof.avatarMimeType ?? "image/webp", prof.avatarBytes) : NO_AVATAR;
      const avatarChanged = avatars[k] !== newAvatar && newAvatar !== NO_AVATAR;
      setAvatar(k, newAvatar);
      let aliasChanged = false;
      if (prof?.alias != null && prof.alias !== "" && contacts[k] == null && seenAliases[k] == null) {
        seenAliases[k] = prof.alias;
        persist("p:aliases", seenAliases);
        aliasChanged = true;
      }
      return avatarChanged || aliasChanged;
    } catch {
      return false;
    }
  }
  function resolveAvatarsThen(pubKeys, rerender) {
    const todo = [...new Set(pubKeys.map((p) => p.toLowerCase()))].filter((k) => !profileChecked.has(k));
    if (todo.length === 0) return;
    void Promise.all(todo.map(ensureAvatar)).then((changed) => {
      if (changed.some(Boolean)) rerender();
    });
  }
  function onAliasSaveClick(e) {
    const btn = e.target?.closest(".alias-save");
    if (btn == null) return;
    const pk = btn.dataset.pk ?? "";
    const alias = btn.dataset.alias ?? "";
    if (pk === "") return;
    saveContact(pk, alias);
    toast(`Saved @${alias}`);
    renderInbox(lastInbox);
    if (lastUpdatesFeed != null) renderUpdatesFeed(lastUpdatesFeed);
    updateMsgToName();
  }
  function updateMsgToName() {
    const to = val("msgTo");
    const el = $("msgToName");
    if (to.length !== 66 && to.length !== 130) {
      el.innerHTML = "";
      return;
    }
    const info = displayName(to);
    el.innerHTML = info.isMe ? "\u21AA that\u2019s your own key" : info.alias != null ? `\u2192 ${nameChip(to, { save: true })}` : "";
  }
  function openContactsModal() {
    renderContacts();
    resolveAvatarsThen([...Object.keys(contacts), ...Object.keys(seenAliases)], renderContacts);
    $("contactsModal").style.display = "flex";
  }
  function closeContactsModal() {
    $("contactsModal").style.display = "none";
  }
  function renderContacts() {
    const host = $("contactsBody");
    host.innerHTML = "";
    const byName = (a, b) => a[1].localeCompare(b[1]);
    const saved = Object.entries(contacts).sort(byName);
    const seen = Object.entries(seenAliases).sort(byName);
    host.append(contactsSection(`Saved (${saved.length})`, saved, "saved", "No saved contacts yet \u2014 save senders from your inbox, or add one above."));
    host.append(contactsSection(`Seen, not saved (${seen.length})`, seen, "seen", "No unsaved names seen yet."));
  }
  function contactsSection(title, rows, kind, empty) {
    const sec = document.createElement("div");
    sec.className = "token-section";
    const head = document.createElement("div");
    head.className = "token-section-head";
    head.style.cursor = "default";
    head.innerHTML = `<span class="token-section-label">${title}</span>`;
    sec.append(head);
    if (rows.length === 0) {
      const p = document.createElement("p");
      p.className = "muted";
      p.style.fontSize = "12px";
      p.textContent = empty;
      sec.append(p);
      return sec;
    }
    for (const [pk, alias] of rows) sec.append(contactRow(pk, alias, kind));
    return sec;
  }
  function contactRow(pk, alias, kind) {
    const row = document.createElement("div");
    row.className = "contact-row";
    row.innerHTML = `${avatarHtml(pk, 24)} <span class="contact-name">@${escapeHtml(alias)}</span> <span class="copy-id" data-copy="${pk}" title="${pk} \u2014 click to copy">${short(pk)}</span>`;
    const acts = document.createElement("span");
    acts.className = "contact-acts";
    const mkBtn = (label, fn) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.className = "secondary";
      b.onclick = fn;
      return b;
    };
    if (kind === "saved") {
      acts.append(
        mkBtn("Rename", () => {
          const n = prompt("New name for this contact:", alias);
          if (n == null) return;
          const nm = n.replace(/^@+/, "").trim();
          if (nm) {
            saveContact(pk, nm, true);
            renderContacts();
            refreshNameSurfaces();
          }
        }),
        mkBtn("Remove", () => {
          removeContact(pk);
          renderContacts();
          refreshNameSurfaces();
        })
      );
    } else {
      acts.append(
        mkBtn("Save", () => {
          saveContact(pk, alias);
          renderContacts();
          refreshNameSurfaces();
        }),
        mkBtn("Ignore", () => {
          ignoreSeen(pk);
          renderContacts();
        })
      );
    }
    row.append(acts);
    return row;
  }
  function onAddContact() {
    const pk = val("contactPk").toLowerCase();
    const name = val("contactName").replace(/^@+/, "").trim();
    if (pk.length !== 66 && pk.length !== 130) {
      toast("Enter a valid pubkey (66 or 130 hex chars)");
      return;
    }
    if (!/^[0-9a-f]+$/.test(pk)) {
      toast("Pubkey must be hex");
      return;
    }
    if (name === "") {
      toast("Enter a name for this contact");
      return;
    }
    saveContact(pk, name, true);
    $("contactPk").value = "";
    $("contactName").value = "";
    renderContacts();
    refreshNameSurfaces();
    toast(`Saved @${name}`);
  }
  var cvObjectUrl = null;
  var currentCollection = null;
  var cvNote = null;
  var cvGiftWif = null;
  function setCvStatus(msg, kind = "info") {
    const el = $("cvStatus");
    el.textContent = msg;
    el.className = `cv-status ${kind === "info" ? "" : kind}`.trim();
  }
  function parseHashRoute() {
    const raw = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;
    if (!raw) return null;
    const params = new URLSearchParams(raw);
    const c = params.get("c");
    if (!c) return null;
    return { c, h: params.get("h"), g: params.get("g") };
  }
  async function loadCollection(tx1Ref) {
    const tx1 = await provider.getSourceTransaction(tx1Ref);
    let template;
    let publisherPubKeyHex = null;
    let storefront = null;
    let hasContentFile = false;
    for (const o of tx1.outputs) {
      const t = parseTemplateScript(o.lockingScript);
      if (t) {
        template = t.fields;
        publisherPubKeyHex = t.publisherPubKeyHex;
      }
      const s2 = parseStorefrontScript(o.lockingScript);
      if (s2) storefront = s2.fields;
      if (parseFileScript(o.lockingScript)) hasContentFile = true;
    }
    if (!template) throw new Error("not a SMART NFTs collection (no template output in TX1)");
    const rules = decodeTokenRules(template.tokenRules);
    let fees = null;
    let isV2 = false, pBps = 0, v2PriceSats = 0;
    if (template.covenantScript) {
      try {
        const ed = parseEditionAny(LockingScript.fromHex(template.covenantScript));
        if (ed?.isV2) {
          isV2 = true;
          pBps = ed.terms.pBps;
          v2PriceSats = ed.priceSats;
        } else if (ed) fees = { publisher: ed.terms.publisherFeeSats, holder: ed.terms.holderFeeSats };
      } catch {
      }
    }
    const cover = storefront?.coverBytes ? { mimeType: storefront.coverMimeType ?? "application/octet-stream", bytes: storefront.coverBytes } : null;
    return {
      tx1Ref,
      name: template.tokenName,
      description: storefront?.description ?? "",
      cover,
      encrypted: rules.isEncrypted,
      replicable: rules.isReplicable,
      hasContentFile,
      publisherPubKeyHex,
      fees,
      isV2,
      pBps,
      v2PriceSats,
      covenantHex: template.covenantScript
    };
  }
  function renderCollectionView(info) {
    $("cvTitle").textContent = info.name || "Untitled collection";
    const coverHost = $("cvCover");
    coverHost.innerHTML = "";
    if (cvObjectUrl) {
      URL.revokeObjectURL(cvObjectUrl);
      cvObjectUrl = null;
    }
    if (info.cover) {
      cvObjectUrl = URL.createObjectURL(new Blob([new Uint8Array(info.cover.bytes)], { type: info.cover.mimeType }));
      const img = document.createElement("img");
      img.src = cvObjectUrl;
      img.className = "cv-cover-img";
      coverHost.append(img);
    } else {
      coverHost.innerHTML = '<div class="cv-cover-ph">\u{1F3B4}</div>';
    }
    const badges = [];
    if (info.replicable) badges.push('<span class="badge">\u267E Unlimited editions</span>');
    if (info.encrypted) badges.push('<span class="badge" style="background:#9e6a03;color:#1a1206">\u{1F512} Holders only</span>');
    else if (info.hasContentFile) badges.push('<span class="badge" style="background:#21262d;color:var(--fg)">\u{1F4CE} Embedded file</span>');
    $("cvBadges").innerHTML = badges.join("");
    $("cvPublisher").innerHTML = info.publisherPubKeyHex ? `by ${nameChip(info.publisherPubKeyHex)}` : "";
    if (info.publisherPubKeyHex != null) {
      const pub = info.publisherPubKeyHex;
      resolveAvatarsThen([pub], () => {
        $("cvPublisher").innerHTML = `by ${nameChip(pub)}`;
      });
    }
    $("cvDesc").textContent = info.description || "(no description provided)";
    if (info.isV2) {
      $("cvPrice").innerHTML = `Get your own copy \u2014 <b>${info.v2PriceSats} sats</b> <span class="muted">(reseller's price; publisher takes ${(info.pBps / 100).toFixed(2)}% = ${Math.floor(info.v2PriceSats * info.pBps / 1e4)} sats, plus a small network fee)</span>`;
    } else if (info.fees) {
      $("cvPrice").innerHTML = `Get your own copy \u2014 <b>${info.fees.publisher + info.fees.holder} sats</b> <span class="muted">(publisher ${info.fees.publisher} + holder ${info.fees.holder}, plus a small network fee)</span>`;
    } else {
      $("cvPrice").innerHTML = '<span class="muted">This collection is not a replicable edition.</span>';
    }
    ;
    $("cvGet").disabled = info.fees == null && !info.isV2;
    const holdsIt = store2.active().some((t) => t.collectionId === info.tx1Ref);
    showViewButton(info, holdsIt);
    $("collectionView").style.display = "flex";
  }
  function showViewButton(info, show) {
    const vb = $("cvView");
    if (show && info.hasContentFile) {
      vb.textContent = info.encrypted ? "\u{1F513} View content" : "View content";
      vb.style.display = "";
    } else {
      vb.style.display = "none";
    }
  }
  async function openCollectionView(tx1Ref, holderPubKey, giftWif = null) {
    cvGiftWif = giftWif;
    $("collectionView").style.display = "flex";
    hideFundPrompt();
    $("cvTitle").textContent = "Loading\u2026";
    $("cvCover").innerHTML = "";
    $("cvBadges").innerHTML = "";
    $("cvPublisher").textContent = "";
    $("cvDesc").textContent = "";
    $("cvPrice").innerHTML = "";
    setCvStatus("Loading collection from the chain\u2026");
    try {
      const info = await loadCollection(tx1Ref);
      currentCollection = { info, holderPubKey };
      renderCollectionView(info);
      if (cvGiftWif) {
        ;
        $("cvGet").textContent = "\u{1F381} Get your free copy";
        $("cvPrice").innerHTML = '\u{1F381} <b>A free gift from the publisher</b> <span class="muted">\u2014 claim your copy, no payment and no funds needed.</span>';
      }
      setCvStatus("");
      void loadSellerNote(info, holderPubKey ?? info.publisherPubKeyHex);
    } catch (e) {
      currentCollection = null;
      $("cvTitle").textContent = "Collection not found";
      setCvStatus(`Could not load this collection: ${e.message}`, "error");
    }
  }
  function onOpenSalesPage(t) {
    history.replaceState(null, "", `${location.pathname}#c=${t.collectionId}&h=${pubKeyHex}`);
    void openCollectionView(t.collectionId, pubKeyHex);
  }
  function closeCollectionView() {
    $("collectionView").style.display = "none";
    if (cvObjectUrl) {
      URL.revokeObjectURL(cvObjectUrl);
      cvObjectUrl = null;
    }
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  }
  function currentShareLink() {
    if (!currentCollection) return null;
    const { info, holderPubKey } = currentCollection;
    const h = holderPubKey ?? pubKeyHex;
    return `${location.origin}${location.pathname}#c=${info.tx1Ref}&h=${h}`;
  }
  function shareCollectionLink() {
    const link = currentShareLink();
    if (!link) return;
    void navigator.clipboard?.writeText(link);
    setCvStatus("Share link copied to clipboard.");
  }
  function showQrModal(title, text) {
    const overlay = document.createElement("div");
    overlay.className = "modal";
    overlay.innerHTML = `<div class="modal-box qr-modal-box"><div class="modal-head"><span>${escapeHtml(title)}</span><button class="secondary qr-close">\u2715 Close</button></div><div class="qr-holder">${qrSvg(text)}</div><div class="qr-cap mono">${escapeHtml(text)}</div></div>`;
    const close = () => overlay.remove();
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    overlay.querySelector(".qr-close")?.addEventListener("click", close);
    document.body.append(overlay);
  }
  function hideBonus() {
    const h = $("cvBonus");
    h.style.display = "none";
    h.innerHTML = "";
  }
  function showBonus(note, claimable) {
    const host = $("cvBonus");
    host.innerHTML = "";
    if (!note?.bonusValue) {
      host.style.display = "none";
      return;
    }
    if (!claimable) {
      host.textContent = "\u{1F381} Includes a bonus \u2014 claim it after you buy.";
    } else if (note.bonusKind === "link") {
      const a = document.createElement("a");
      a.href = note.bonusValue;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "\u{1F381} Claim your bonus \u2197";
      a.className = "bonus-claim";
      host.append(a);
    } else {
      host.append(document.createTextNode("\u{1F381} Bonus code: "));
      const code = document.createElement("span");
      code.className = "mono";
      code.textContent = note.bonusValue;
      const copy = document.createElement("button");
      copy.className = "secondary";
      copy.textContent = "Copy";
      copy.style.marginLeft = "8px";
      copy.onclick = () => void navigator.clipboard?.writeText(note.bonusValue);
      host.append(code, copy);
    }
    host.style.display = "block";
  }
  async function loadSellerNote(info, sellerPub) {
    cvNote = null;
    const noteBox = $("cvNote");
    noteBox.style.display = "none";
    hideBonus();
    const isMine = sellerPub != null && sellerPub === pubKeyHex;
    const holdsIt = store2.active().some((t) => t.collectionId === info.tx1Ref);
    $("cvNoteEdit").style.display = isMine ? "block" : "none";
    $("cvNoteText").value = "";
    $("cvBonusValue").value = "";
    $("cvBonusKind").value = "none";
    $("cvNoteStatus").textContent = "";
    if (sellerPub == null) return;
    let current = null;
    try {
      const note = await resolveSellerNote(provider, sellerPub, info.tx1Ref);
      if (note) current = note;
    } catch {
    }
    if (current == null && info.covenantHex) {
      try {
        const tip = await resolveHolderEdition(provider, { tx1RefHex: info.tx1Ref, holderPubKeyHex: sellerPub, templateCovenantHex: info.covenantHex });
        if (tip) current = readNoteFromTx(await provider.getSourceTransaction(tip.txId), info.tx1Ref);
      } catch {
      }
    }
    if (current == null && isMine) {
      const held = store2.active().find((t) => t.collectionId === info.tx1Ref && (t.sellerNote || t.bonusValue));
      if (held) {
        current = { text: held.sellerNote ?? "", bonusKind: held.bonusKind, bonusValue: held.bonusValue };
        $("cvNoteStatus").textContent = "This is what you received when you bought \u2014 Publish to pass it on.";
      }
    }
    if (current && (current.text || current.bonusValue)) {
      cvNote = current;
      if (current.text) {
        noteBox.textContent = `\u{1F4DD} Seller\u2019s note: ${current.text}`;
        noteBox.style.display = "block";
      }
      showBonus(current, holdsIt);
      if (isMine) {
        ;
        $("cvNoteText").value = current.text;
        if (current.bonusKind && current.bonusValue) {
          ;
          $("cvBonusKind").value = current.bonusKind;
          $("cvBonusValue").value = current.bonusValue;
        }
      }
    }
  }
  async function onSaveSellerNote() {
    if (!currentCollection) return;
    const text = $("cvNoteText").value.trim();
    const bonusKindRaw = $("cvBonusKind").value;
    const bonusValue = $("cvBonusValue").value.trim();
    const bonusKind = bonusKindRaw === "link" || bonusKindRaw === "code" ? bonusKindRaw : void 0;
    if (!text && !bonusValue) {
      $("cvNoteStatus").textContent = "Add a note or a bonus first.";
      return;
    }
    if (bonusValue && !bonusKind) {
      $("cvNoteStatus").textContent = "Pick a bonus type (link or code).";
      return;
    }
    const note = { text, bonusKind, bonusValue: bonusValue || void 0 };
    $("cvNoteStatus").textContent = "Publishing your note\u2026";
    try {
      const txId = await publishSellerNote(provider, key, currentCollection.info.tx1Ref, note);
      cvNote = note;
      if (text) {
        $("cvNote").textContent = `\u{1F4DD} Seller\u2019s note: ${text}`;
        $("cvNote").style.display = "block";
      }
      showBonus(note, true);
      $("cvNoteStatus").textContent = `Published (${short(txId)}). Buyers will see it shortly.`;
    } catch (e) {
      $("cvNoteStatus").textContent = `Failed: ${e.message}`;
    }
  }
  function showFundPrompt(needed, have) {
    $("cvFundNeed").textContent = `${needed} sats`;
    $("cvFundHave").textContent = `${have} sats`;
    $("cvFundAddr").textContent = address;
    $("cvFundQr").innerHTML = `<div class="qr-holder qr-fund">${qrSvg(bsvPaymentUri(address, needed))}</div>`;
    $("cvFund").style.display = "block";
    setCvStatus("Not enough funds yet \u2014 send a little BSV to your wallet, then click \u201CI\u2019ve funded\u201D.", "error");
  }
  function hideFundPrompt() {
    $("cvFund").style.display = "none";
  }
  var buying = false;
  async function onGetCopy() {
    if (buying || !currentCollection) return;
    const { info, holderPubKey } = currentCollection;
    if (!info.fees && !info.isV2 || !info.covenantHex) {
      setCvStatus("This collection is not a buyable edition.", "error");
      return;
    }
    const sellerPub = holderPubKey ?? info.publisherPubKeyHex;
    if (!sellerPub) {
      setCvStatus("No seller could be determined for this link.", "error");
      return;
    }
    buying = true;
    $("cvGet").disabled = true;
    try {
      setCvStatus("Finding the seller\u2019s current edition\u2026");
      let tip = await resolveHolderEdition(provider, { tx1RefHex: info.tx1Ref, holderPubKeyHex: sellerPub, templateCovenantHex: info.covenantHex });
      if (!tip) {
        setCvStatus("This seller has no edition available right now \u2014 try another link or ask them to mint one.", "error");
        return;
      }
      if (cvGiftWif) {
        let giftNote = cvNote;
        if (!giftNote) {
          try {
            giftNote = readNoteFromTx(await provider.getSourceTransaction(tip.txId), info.tx1Ref);
          } catch {
          }
        }
        setCvStatus("\u{1F381} Claiming your free copy\u2026");
        const claimed = await claimGiftEdition(provider, key, {
          giftWif: cvGiftWif,
          editionTxId: tip.txId,
          editionOutputIndex: tip.outputIndex,
          editionLockHex: tip.lockHex,
          note: giftNote ?? void 0
        });
        storeEdition(
          { txId: claimed.replicaOutpoint.txId, outputIndex: claimed.replicaOutpoint.outputIndex, lockHex: claimed.lockHex },
          info.tx1Ref,
          info.name,
          tip.terms,
          giftNote
        );
        renderTokens();
        showViewButton(info, true);
        setCvStatus("\u{1F381} It\u2019s yours! Your free copy is now in My NFTs.", "ok");
        cvGiftWif = null;
        return;
      }
      const publisherCut = tip.isV2 ? Math.floor(tip.priceSats * info.pBps / 1e4) : tip.terms.publisherFeeSats;
      const resellerCut = tip.isV2 ? tip.priceSats - publisherCut : tip.terms.holderFeeSats;
      const price = publisherCut + resellerCut;
      const ok = confirm(
        `Buy a copy of \u201C${info.name}\u201D for ${price} sats?

` + (tip.isV2 ? `publisher ${(info.pBps / 100).toFixed(2)}% = ${publisherCut} + reseller ${resellerCut} sats, plus a small network fee.
` : `publisher ${publisherCut} + holder ${resellerCut} sats, plus a small network fee.
`) + `This is an instant, on-chain purchase.`
      );
      if (!ok) {
        setCvStatus("Purchase cancelled.");
        return;
      }
      const needed = price + 2 * tip.tokenSats + 1200;
      const have = (await getSafeUtxos(provider)).reduce((s2, u) => s2 + u.satoshis, 0);
      if (have < needed) {
        showFundPrompt(needed, have);
        return;
      }
      hideFundPrompt();
      let echoNote = cvNote;
      if (!echoNote) {
        try {
          echoNote = readNoteFromTx(await provider.getSourceTransaction(tip.txId), info.tx1Ref);
        } catch {
        }
      }
      setCvStatus("Buying your copy \u2014 replicating the edition\u2026");
      let bought = null;
      for (let attempt = 0; attempt <= 2; attempt++) {
        try {
          bought = tip.isV2 ? await replicateEditionV2(provider, key, { editionTxId: tip.txId, editionOutputIndex: tip.outputIndex, editionLockHex: tip.lockHex, note: echoNote ?? void 0 }) : await replicateEdition(provider, key, { editionTxId: tip.txId, editionOutputIndex: tip.outputIndex, editionLockHex: tip.lockHex, terms: tip.terms, note: echoNote ?? void 0 });
          break;
        } catch (e) {
          if (attempt === 2) throw e;
          setCvStatus("Another buyer was first \u2014 finding the seller\u2019s new edition\u2026");
          const again = await resolveHolderEdition(provider, { tx1RefHex: info.tx1Ref, holderPubKeyHex: sellerPub, templateCovenantHex: info.covenantHex });
          if (!again) throw new Error("the seller\u2019s edition is no longer available");
          tip = again;
        }
      }
      if (!bought) return;
      storeEdition(
        { txId: bought.replicaOutpoint.txId, outputIndex: bought.replicaOutpoint.outputIndex, lockHex: bought.lockHex },
        info.tx1Ref,
        info.name,
        tip.terms,
        echoNote
      );
      renderTokens();
      showViewButton(info, true);
      showBonus(echoNote, true);
      setCvStatus(
        `\u2705 You own a copy of \u201C${info.name}\u201D! Tx ${short(bought.txId)} \u2014 it\u2019s now in your wallet.` + (echoNote?.text ? `
\u{1F4DD} Seller\u2019s note: ${echoNote.text}` : "") + (echoNote?.bonusValue ? "\n\u{1F381} Bonus included \u2014 claim it below / on the NFT card." : "")
      );
      if (info.hasContentFile) void onView(info.tx1Ref, info.name);
    } catch (e) {
      setCvStatus(`Could not complete the purchase: ${e.message}`, "error");
    } finally {
      buying = false;
      $("cvGet").disabled = false;
    }
  }
  async function onBroadcast(t) {
    const text = prompt(`Announce to all holders of \u201C${t.collectionName ?? "this collection"}\u201D.

Public, one transaction, reaches every current holder. Message:`);
    if (text == null) return;
    const trimmed = text.trim();
    if (!trimmed) {
      setStatus("Announcement was empty.", "error");
      return;
    }
    setStatus("Publishing announcement to holders\u2026");
    try {
      const txId = await publishBroadcast(provider, key, t.collectionId, trimmed, getMyAlias());
      latestBroadcast.set(t.collectionId, { text: trimmed, txId, height: 0 });
      renderTokens();
      setStatus(`\u{1F4E3} Announcement published (${short(txId)}). Holders see it when they check Updates.`, "ok");
    } catch (e) {
      setStatus(`Broadcast failed: ${e.message}`, "error");
    }
  }
  async function onGiftCopies(t) {
    let claimCost = 0;
    try {
      const ed = parseEditionAny(LockingScript.fromHex(t.lockHex ?? ""));
      if (ed) claimCost = ed.isV2 ? ed.priceSats : ed.terms.publisherFeeSats + ed.terms.holderFeeSats;
    } catch {
    }
    const fundEach = claimCost + 700 + 800;
    const countStr = prompt(
      `Create free-gift links for \u201C${t.collectionName ?? "this collection"}\u201D.

How many?  Each is pre-funded with ~${fundEach} sats \u2014 but the price + fees come back to you as the holder, so your real cost is \u2248 the miner fee per claim.`,
      "10"
    );
    if (countStr == null) return;
    const count = Math.max(1, Math.min(500, parseInt(countStr, 10) || 0));
    const total = count * fundEach;
    if (!confirm(`Fund ${count} gift link(s) at ~${fundEach} sats each (~${total} sats from your wallet; most returns on claim). Proceed?`)) return;
    setStatus(`Creating ${count} funded gift link(s)\u2026`);
    try {
      const { fundingTxId, voucherWifs } = await createGiftVouchers(provider, key, { count, fundEachSats: fundEach });
      const links = voucherWifs.map((wif) => `${location.origin}${location.pathname}#c=${t.collectionId}&h=${pubKeyHex}&g=${wif}`);
      setStatus(`\u2705 ${count} gift link(s) funded (tx ${short(fundingTxId)}). Hand them out from the popup.`, "ok");
      showGiftLinksModal(t.collectionName ?? "Free gift", links);
    } catch (e) {
      setStatus(`Gift creation failed: ${e.message}`, "error");
    }
  }
  function showGiftLinksModal(title, links) {
    const overlay = document.createElement("div");
    overlay.className = "modal";
    const rows = links.map((l, i) => `<div class="gift-row"><span class="mono gift-link">${escapeHtml(l)}</span><button class="secondary gift-qr" data-i="${i}">QR</button></div>`).join("");
    overlay.innerHTML = `<div class="modal-box gift-modal-box"><div class="modal-head"><span>\u{1F381} ${escapeHtml(title)} \u2014 ${links.length} gift link${links.length > 1 ? "s" : ""}</span><button class="secondary gift-close">\u2715 Close</button></div><div class="row" style="margin-bottom:10px"><button class="gift-copyall">Copy all</button><button class="secondary gift-download">Download .txt</button></div><div class="gift-list">${rows}</div><p class="muted" style="font-size:11px;margin-top:10px">Each link is single-use and pre-funded. Hand them out (email, DM, in person); the recipient claims a free copy and can resell it \u2014 your publisher fee returns on every resale.</p></div>`;
    const close = () => overlay.remove();
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    overlay.querySelector(".gift-close")?.addEventListener("click", close);
    overlay.querySelector(".gift-copyall")?.addEventListener("click", () => void navigator.clipboard?.writeText(links.join("\n")));
    overlay.querySelector(".gift-download")?.addEventListener("click", () => {
      const blob = new Blob([links.join("\n")], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "smart-nfts-gift-links.txt";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1e3);
    });
    overlay.querySelectorAll(".gift-qr").forEach((b) => b.addEventListener("click", () => {
      showQrModal("Scan to claim a free copy", links[parseInt(b.dataset.i ?? "0", 10)]);
    }));
    document.body.append(overlay);
  }
  async function onCheckUpdates() {
    const host = $("updatesFeed");
    const held = [...new Set(store2.active().map((t) => t.collectionId))];
    if (held.length === 0) {
      host.innerHTML = '<p class="muted">No collections held yet \u2014 buy or mint an edition to receive publisher updates.</p>';
      return;
    }
    host.innerHTML = '<p class="muted">Checking for updates\u2026</p>';
    const feed = [];
    for (const collectionId of held) {
      try {
        const info = await loadCollection(collectionId);
        if (!info.publisherPubKeyHex) continue;
        const list = await resolveBroadcasts(provider, info.publisherPubKeyHex, collectionId);
        if (list.length > 0) latestBroadcast.set(collectionId, list[0]);
        for (const b of list) feed.push({ ...b, name: info.name, publisherPubKeyHex: info.publisherPubKeyHex });
      } catch {
      }
    }
    feed.sort((a, b) => (b.height || 1e12) - (a.height || 1e12));
    applyLatestAliases(feed.map((b) => ({ pk: b.publisherPubKeyHex, alias: b.senderAlias })));
    renderTokens();
    renderUpdatesFeed(feed);
    resolveAvatarsThen(feed.map((b) => b.publisherPubKeyHex), () => {
      if (lastUpdatesFeed != null) renderUpdatesFeed(lastUpdatesFeed);
    });
  }
  function renderUpdatesFeed(feed) {
    lastUpdatesFeed = feed;
    const host = $("updatesFeed");
    if (feed.length === 0) {
      host.innerHTML = '<p class="muted">No announcements yet from the publishers of your collections.</p>';
      return;
    }
    host.innerHTML = feed.map(
      (b) => `<div class="token msg"><div class="token-name">\u{1F4E3} ${escapeHtml(b.name || "Collection")}</div><div class="mono" style="font-size:12px">by ${nameChip(b.publisherPubKeyHex, { save: true })}</div><div class="state" style="color:var(--accent);white-space:pre-wrap">${escapeHtml(b.text)}</div><div class="mono">${short(b.txId)}</div></div>`
    ).join("");
  }
  function initTabs() {
    const tabs = Array.from(document.querySelectorAll(".tab"));
    const panels = Array.from(document.querySelectorAll(".tabpanel"));
    const activate = (name) => {
      tabs.forEach((t) => t.classList.toggle("is-active", t.dataset.tab === name));
      panels.forEach((p) => p.classList.toggle("is-active", p.id === `tab-${name}`));
      try {
        localStorage.setItem("p:activeTab", name);
      } catch {
      }
    };
    tabs.forEach((t) => {
      t.onclick = () => activate(t.dataset.tab);
    });
    document.querySelectorAll("[data-goto]").forEach((el) => {
      el.onclick = () => activate(el.dataset.goto);
    });
    let saved = null;
    try {
      saved = localStorage.getItem("p:activeTab");
    } catch {
    }
    if (saved && tabs.some((t) => t.dataset.tab === saved)) activate(saved);
  }
  function init() {
    store2 = new PharLapStore();
    loadAliases();
    useKey(loadKey());
    try {
      if (localStorage.getItem("p:nftview") === "grid") nftView = "grid";
    } catch {
    }
    updateViewToggle();
    renderTokens();
    initTabs();
    document.addEventListener("click", onCopyClick);
    document.addEventListener("click", onAliasSaveClick);
    $("myAlias").value = getMyAlias() ? "@" + getMyAlias() : "";
    $("btnSaveAlias").onclick = () => {
      const a = val("myAlias").replace(/^@+/, "").trim();
      setMyAlias(a);
      $("myAlias").value = a ? "@" + a : "";
      toast(a ? `Your alias is now @${a}` : "Alias cleared");
    };
    $("btnViewList").onclick = () => setNftView("list");
    $("btnViewGrid").onclick = () => setNftView("grid");
    $("tokenModalClose").onclick = () => closeTokenModal();
    $("tokenModal").addEventListener("click", (e) => {
      if (e.target === $("tokenModal")) closeTokenModal();
    });
    $("tokenModalBody").addEventListener("click", (e) => {
      if (e.target.closest("button") != null) $("tokenModal").style.display = "none";
    }, true);
    $("btnRefresh").onclick = () => void refreshBalance();
    $("btnMint").onclick = () => void onMint();
    $("btnV2Probe").onclick = () => void onV2Probe();
    $("btnMintEdition").onclick = () => void onMintEdition();
    $("btnIncoming").onclick = () => void onCheckIncoming();
    $("btnSendMessage").onclick = () => void onSendMessage();
    $("btnCheckMessages").onclick = () => void onCheckMessages();
    $("msgTo").addEventListener("input", updateMsgToName);
    $("btnContacts").onclick = () => openContactsModal();
    $("btnPublishProfile").onclick = () => void onPublishProfile();
    $("contactsClose").onclick = () => closeContactsModal();
    $("contactsModal").addEventListener("click", (e) => {
      if (e.target === $("contactsModal")) closeContactsModal();
    });
    $("contactAdd").onclick = () => onAddContact();
    $("btnCheckUpdates").onclick = () => void onCheckUpdates();
    $("btnNewWallet").onclick = () => {
      if (!confirm("Replace the current wallet with a new random key? Your current key is in the WIF box \u2014 back it up first.")) return;
      switchWallet(PrivateKey.fromRandom(), false);
      setStatus("New wallet created.", "ok");
    };
    $("btnRestore").onclick = () => {
      let k;
      try {
        k = PrivateKey.fromWif(val("restoreWif"));
      } catch {
        setStatus("Invalid WIF.", "error");
        return;
      }
      switchWallet(k, true);
    };
    $("btnCopyPub").onclick = () => void navigator.clipboard?.writeText(pubKeyHex);
    $("btnCopyAddr").onclick = () => void navigator.clipboard?.writeText(address);
    $("btnQrAddr").onclick = () => showQrModal("Receive address \u2014 BSV only", address);
    $("btnQrPub").onclick = () => showQrModal("Public key \u2014 scan to share", pubKeyHex);
    $("btnWifShow").onclick = () => {
      const el = $("wif");
      const showing = el.type === "text";
      el.type = showing ? "password" : "text";
      $("btnWifShow").textContent = showing ? "\u{1F441} Show" : "\u{1F648} Hide";
    };
    $("btnWifCopy").onclick = () => {
      void navigator.clipboard?.writeText($("wif").value);
      const b = $("btnWifCopy");
      const prev = b.textContent;
      b.textContent = "Copied \u2713";
      setTimeout(() => {
        b.textContent = prev;
      }, 1200);
    };
    $("viewerClose").onclick = () => closeViewer();
    $("viewer").onclick = (e) => {
      if (e.target === $("viewer")) closeViewer();
    };
    $("cvWallet").onclick = () => closeCollectionView();
    $("cvShare").onclick = () => shareCollectionLink();
    $("cvQr").onclick = () => {
      const l = currentShareLink();
      if (l) showQrModal("Scan to open this sales page", l);
    };
    $("cvGet").onclick = () => void onGetCopy();
    $("cvView").onclick = () => {
      if (currentCollection) void onView(currentCollection.info.tx1Ref, currentCollection.info.name);
    };
    $("cvNoteSave").onclick = () => void onSaveSellerNote();
    $("cvFundCopy").onclick = () => void navigator.clipboard?.writeText(address);
    $("cvFundDone").onclick = () => void onGetCopy();
    window.addEventListener("hashchange", () => {
      const r2 = parseHashRoute();
      if (r2) void openCollectionView(r2.c, r2.h, r2.g);
      else closeCollectionView();
    });
    const route = parseHashRoute();
    if (route) void openCollectionView(route.c, route.h, route.g);
    void refreshBalance();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
//# sourceMappingURL=bundle.js.map
