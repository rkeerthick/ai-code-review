// Plain JS — Vercel serves this directly without esbuild touching NestJS.
// nest build (tsc) compiles src/vercel.ts → dist/vercel.js beforehand.
const { getHandler } = require('../dist/vercel');

let handler;

module.exports = async (req, res) => {
  if (!handler) handler = await getHandler();
  handler(req, res);
};
