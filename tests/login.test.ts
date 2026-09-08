import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Login from '../app/login/page';

test('login renders an enabled submit button inside the credentials form', () => {
  const html = renderToStaticMarkup(createElement(Login));
  const form = html.match(/<form\b[^>]*>([\s\S]*?)<\/form>/)?.[1];
  assert.ok(form, 'Login must render a form');
  assert.match(form, /<input\b[^>]*name="email"/);
  assert.match(form, /<input\b[^>]*name="password"/);
  const button = form.match(/<button\b([^>]*)>Sign in<\/button>/)?.[1];
  assert.ok(button, 'Login must render the Sign in button');
  assert.match(button, /\btype="submit"/, 'Clicking Sign in must submit the form');
  assert.doesNotMatch(button, /\bdisabled(?:\s|=|$)/);
});
