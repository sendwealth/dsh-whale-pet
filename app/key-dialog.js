'use strict';

// Key dialog logic: reads the input, sends it to the main process over
// IPC, closes when saved. The key itself never touches localStorage or
// any renderer-side storage.

const input = document.getElementById('key');
const save = document.getElementById('save');

function submit() {
  const value = input.value.trim();
  if (value === '') return;
  window.whalePet.setApiKey(value).then(() => { window.close(); });
}

save.addEventListener('click', submit);
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') submit();
});
input.focus();
