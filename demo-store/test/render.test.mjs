import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { render } from "../render.mjs";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("injects the Hollaback API origin into the snippet tag", () => {
  const out = render("index.html", html, "https://api.example.com/");
  assert.match(out, /<script src="https:\/\/api\.example\.com\/hb\.js" data-merchant="demo" async><\/script>/);
  assert.doesNotMatch(out, /__HOLLABACK_API__/);
});

test("loads the PayPal JS SDK v6 sandbox core with an onLoad hook", () => {
  assert.match(html, /<script async src="https:\/\/www\.sandbox\.paypal\.com\/web-sdk\/v6\/core" onload="onLoad\(\)"><\/script>/);
});

test("has PayPal, Pay Later and Pay Later messaging elements", () => {
  assert.match(html, /<paypal-button[^>]*hidden/);
  assert.match(html, /<paypal-pay-later-button[^>]*hidden/);
  assert.match(html, /<paypal-message[^>]*auto-bootstrap[^>]*amount="89\.00"[^>]*currency-code="USD"/);
});

test("leaves non-HTML files untouched", () => {
  assert.equal(render("store.js", "__HOLLABACK_API__", "x"), "__HOLLABACK_API__");
});
