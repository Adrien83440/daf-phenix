#!/usr/bin/env node
// Produit la ligne à mettre dans la variable DAF_ADMINS (Vercel → Settings → Environment Variables).
//   npm run admin:hash -- adrien@exemple.com "mon mot de passe"
// Plusieurs comptes : sépare les entrées par des virgules dans la variable.
"use strict";
const auth = require("../lib/auth.js");
const [email, password] = process.argv.slice(2);
if (!email || !password) { console.error("Usage : npm run admin:hash -- email motdepasse"); process.exit(1); }
try {
  console.log("DAF_ADMINS=" + auth.normEmail(email) + ":" + auth.hashPassword(password));
} catch (e) { console.error(e.message); process.exit(1); }
