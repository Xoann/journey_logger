const DECIMAL = /^(?:\d+\.?\d*|\.\d+)$/;

// Parse only arithmetic; never evaluate the input as JavaScript.
export function parseAmount(input) {
  const positive = value => {
    if (!Number.isFinite(value) || value <= 0) throw new Error('Amount must be a positive finite number.');
    return value;
  };
  if (typeof input === 'number') return positive(input);
  if (typeof input !== 'string' || input.length > 4096) throw new Error('Use an amount of at most 4096 characters.');
  const tokens = input.match(/\d+\.?\d*|\.\d+|[()+\-*/]|\S/g) || [];
  let index = 0;
  const invalid = () => { throw new Error('Use numbers, + - * / and parentheses.'); };
  const finite = value => {
    if (!Number.isFinite(value)) throw new Error('Calculation must stay finite.');
    return value;
  };

  function factor(depth) {
    let sign = 1;
    if (tokens[index] === '+' || tokens[index] === '-') sign = tokens[index++] === '-' ? -1 : 1;
    if (tokens[index] === '(') {
      if (depth >= 32) throw new Error('Use fewer nested parentheses (max 32).');
      index++;
      const value = expression(depth + 1);
      if (tokens[index++] !== ')') invalid();
      return sign * value;
    }
    const token = tokens[index++];
    if (!token || !DECIMAL.test(token)) invalid();
    return sign * finite(Number(token));
  }

  function term(depth) {
    let value = factor(depth);
    while (tokens[index] === '*' || tokens[index] === '/') {
      const operator = tokens[index++], right = factor(depth);
      if (operator === '/' && right === 0) throw new Error('Cannot divide by zero.');
      value = finite(operator === '*' ? value * right : value / right);
    }
    return value;
  }

  function expression(depth) {
    let value = term(depth);
    while (tokens[index] === '+' || tokens[index] === '-') {
      const operator = tokens[index++], right = term(depth);
      value = finite(operator === '+' ? value + right : value - right);
    }
    return value;
  }

  const value = expression(0);
  if (index !== tokens.length) invalid();
  return positive(value);
}
