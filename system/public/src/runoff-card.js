import {runoff} from './analysis-math.js';
export function mountRunoff() {
  const choices=document.querySelector('#runoff-rain');
  function update() {
    const rain=Number(choices.value);
    for(const row of document.querySelectorAll('[data-runoff-cn]')) {
      const q=runoff(rain,Number(row.dataset.runoffCn));
      row.querySelector('meter').max=rain;
      row.querySelector('meter').value=q;
      row.querySelector('output').textContent='径流 '+q.toFixed(1)+' mm · 综合损失 '+(rain-q).toFixed(1)+' mm';
    }
  }
  choices.onchange=update;
  update();
}
