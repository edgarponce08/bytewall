'use strict';

const form = document.querySelector('#login-form');
const errorBox = form.querySelector('[data-error]');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = form.querySelector('button[type="submit"]');
  const data = Object.fromEntries(new FormData(form));

  errorBox.hidden = true;
  submit.disabled = true;
  submit.textContent = 'Entrando…';

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: data.email, password: data.password }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error || `Error ${response.status}`);
    window.location.replace('/');
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
    form.password.value = '';
    form.password.focus();
    submit.disabled = false;
    submit.textContent = 'Entrar';
  }
});
