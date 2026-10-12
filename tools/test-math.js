#!/usr/bin/env node
/* Tests du moteur mathématique (node tools/test-math.js). */
'use strict';
const path = require('path');
const NM = require(path.join(__dirname, '../app/src/main/assets/web/js/math.js'));

let failed = 0, passed = 0;
function near(a, b, tol) {
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  if (!Number.isFinite(b)) return a === b;
  return Math.abs(a - b) <= (tol || 1e-9) * Math.max(1, Math.abs(b));
}
function check(name, ok, info) {
  if (ok) passed++;
  else { failed++; console.error('ÉCHEC', name, info === undefined ? '' : info); }
}
function ev(src, env) { return NM.evaluate(src, env && env.V, env && env.U, env); }
function val(src, expected, tol) {
  let got;
  try { got = ev(src); } catch (e) { got = 'erreur: ' + e.message; }
  check(src, typeof got === 'number' && near(got, expected, tol), got + ' ≠ ' + expected);
}
function err(src) {
  let threw = false;
  try { ev(src); } catch (e) { threw = e instanceof NM.MathError; }
  check('erreur attendue : ' + src, threw);
}
function fx(src, x, expected, tol) {
  const ast = NM.parse(src);
  const f = NM.build(NM.compile(ast, { slots: new Set(['x']) }), ['x'])(NM.M, {}, {});
  const got = f(x);
  check(src + ' @x=' + x, near(got, expected, tol), got + ' ≠ ' + expected);
}

// Arithmétique et priorités
val('1+2*3', 7);
val('2^3^2', 512);
val('-2^2', -4);
val('2^-1', 0.5);
val('(1+2)(3+4)', 21);
val('2(3)', 6);
val('6/2(1+2)', 9);
val('10 − 4 × 2', 2);
val('8 ÷ 4', 2);
val('3²', 9);
val('2³+1', 9);
val('10⁻¹', 0.1);
val('5!', 120);
val('0.5!', 0.886226925452758, 1e-9);
val('50%', 0.5);
val('|−3|', 3);
val('2|−3|', 6);
val('√16', 4);
val('√(9)+1', 4);
val('∛27', 3);
val('2π', 2 * Math.PI);
val('1.5ᴇ3', 1500);
val('1E-3', 0.001);
// Fonctions
val('sin(π/2)', 1);
val('sin π', 0);
val('cos(0)', 1);
val('tan(π/4)', 1, 1e-12);
val('sin^2(1)+cos^2(1)', 1);
val('sin⁻¹(1)', Math.PI / 2);
val('arcsin(1)', Math.PI / 2);
val('ln(e)', 1);
val('log(1000)', 3);
val('log(8, 2)', 3);
val('log2(1024)', 10);
val('exp(0)', 1);
val('e^2', Math.E * Math.E);
val('root(-27, 3)', -3);
val('(-8)^(1/3)', -2);
val('(-8)^(2/3)', 4);
val('(-2)^0.5', NaN);
val('max(1, 5, 3)', 5);
val('min(4, -2)', -2);
val('mod(-7, 3)', 2);
val('gcd(12, 18)', 6);
val('lcm(4, 6)', 12);
val('nCr(5, 2)', 10);
val('nPr(5, 2)', 20);
val('round(3.14159, 2)', 3.14);
val('floor(-1.5)', -2);
val('ceil(1.2)', 2);
val('sign(-4)', -1);
val('sin 2π', 0);
val('2 sin(π/6)', 1, 1e-12);
// Intégrales, sommes, dérivées
val('int(x^2, 0, 3)', 9, 1e-10);
val('∫(t², 0, 3)', 9, 1e-10);
val('int(1/sqrt(x), 0, 1)', 2, 1e-6);
val('int(e^(-x^2), -inf, inf)', Math.sqrt(Math.PI), 1e-8);
val('int(x, 3, 0)', -4.5, 1e-10);
val('sum(n, 1, 100)', 5050);
val('Σ(k^2, k, 1, 10)', 385);
val('prod(n, 1, 5)', 120);
fx('d/dx(x^3)', 2, 12, 1e-8);
fx('d/dx sin(x)', 0, 1, 1e-9);
fx('x sin x', Math.PI / 2, Math.PI / 2, 1e-12);
fx('2x^2 + 3x - 1', 2, 13);
fx('xx', 3, 9);
fx('sinx', Math.PI / 2, 1);
fx('ln x + 1', Math.E, 2);
fx('∫(t, 0, x)', 4, 8, 1e-10);
// Fonctions utilisateur et dérivées
{
  const U = {};
  const V = { a: 2 };
  U.f = NM.build(NM.compile(NM.parse('a·x^2'), { scope: { x: 'p0' }, vars: new Set(['a']) }), ['p0'])(NM.M, V, U);
  const env = { vars: new Set(['a']), funcs: new Map([['f', 1]]), V, U };
  check("f(3)", near(ev('f(3)', env), 18));
  check("f'(3)", near(ev("f'(3)", env), 12, 1e-8));
  check("f''(3)", near(ev("f''(3)", env), 4, 1e-6));
  check('a(2)', near(ev('a(2)', env), 4));
  check('2a', near(ev('2a', env), 4));
}
// Erreurs
err('2+');
err('sin()');
err('a+1');
err('max()');
err('1 = 2 = 3');
err('3 # 4');
// Angles en degrés
NM.setAngleMode('deg');
val('sin(30)', 0.5, 1e-12);
val('sin(180)', 0);
val('acos(0)', 90);
NM.setAngleMode('rad');
// Formatage
check('fmt 0.1+0.2', NM.fmt(0.1 + 0.2) === '0.3', NM.fmt(0.1 + 0.2));
check('fmt négatif', NM.fmt(-2.5) === '−2.5', NM.fmt(-2.5));
check('fmt grand', NM.fmt(1.5e20) === '1.5×10²⁰', NM.fmt(1.5e20));
check('fmt petit', NM.fmt(2e-9) === '2×10⁻⁹', NM.fmt(2e-9));
check('fraction', NM.toFraction(0.75) === '3/4', NM.toFraction(0.75));
check('fraction π', NM.toFraction(Math.PI / 2) === 'π/2', NM.toFraction(Math.PI / 2));
check('pas de fraction', NM.toFraction(Math.SQRT2) === null, NM.toFraction(Math.SQRT2));
// Relations et structures
{
  const r = NM.parse('y = 2x + 1');
  check('relation', r.k === 'rel' && r.op === '=' && r.a.k === 'var', JSON.stringify(r));
  const t = NM.parse('(cos t, sin t)');
  check('tuple', t.k === 'tuple' && t.items.length === 2);
  const q = NM.parse('x² + y² ≤ 9');
  check('inégalité', q.k === 'rel' && q.op === '<=');
  const h = NM.toHTML(NM.parse('y = (x+1)/(x−1) + √x + x²'));
  check('rendu HTML', /frac/.test(h) && /msqrt/.test(h) && /<sup>/.test(h), h);
  const s = NM.symbols(NM.parse('a x + f(x) + ∫(t, 0, b)'), (n) => n === 'f');
  check('symboles', [...s.vars].sort().join() === 'a,b,x' && [...s.calls].join() === 'f', JSON.stringify([...s.vars]));
}

console.log(passed + ' tests réussis, ' + failed + ' échec(s).');
process.exit(failed ? 1 : 0);
