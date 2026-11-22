'use strict';

var mascotDrawing = [
  '<svg viewBox="0 0 210 184" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">',
  '<ellipse class="mascot-shadow" cx="105" cy="163" rx="48" ry="8" fill="#30204a" opacity=".14"/>',
  '<g class="mascot-sparks" stroke="#2b1849" stroke-width="3" stroke-linejoin="round">',
  '<path d="M173 25l4 8 9 1-7 6 2 9-8-5-8 5 2-9-7-6 9-1Z" fill="#ff899c"/>',
  '<path d="M33 39v15m-7-8h14M181 66v13m-6-6h12" fill="none" stroke-linecap="round"/>',
  '</g>',
  '<g class="mascot-body" stroke="#2b1849" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round">',
  '<path d="M72 121v17q0 7-6 10m71-27v17q1 7 6 10" fill="none"/>',
  '<path d="M52 151q3-9 12-7l11 5q4 7-6 9H55q-5-1-3-7Zm83-3 12-4q10-2 12 7 2 6-5 7h-14q-9-1-5-10Z" fill="#af96fc"/>',
  '<path d="M53 81 34 67l-9 3-4-5m137 17 18-16 8 2 5-5" fill="none"/>',
  '<g transform="rotate(-7 104 81)">',
  '<rect x="57" y="33" width="103" height="105" rx="12" fill="#2b1849"/>',
  '<rect x="49" y="26" width="103" height="105" rx="12" fill="#fffdf6"/>',
  '<rect x="61" y="39" width="79" height="63" rx="5" fill="#d5f553" stroke-width="3.5"/>',
  '<path d="M78 115h28" fill="none" stroke="#9a84be" stroke-width="3"/>',
  '<g class="mascot-eyes" fill="#2b1849" stroke="none"><circle cx="86" cy="67" r="4.5"/><circle cx="115" cy="67" r="4.5"/></g>',
  '<g fill="#ef8295" stroke="none"><ellipse cx="77" cy="77" rx="5.5" ry="3"/><ellipse cx="124" cy="77" rx="5.5" ry="3"/></g>',
  '<path class="mascot-smile" d="M92 77q8 13 17 0Z" fill="#2b1849" stroke-width="2"/>',
  '<path class="mascot-frown" d="M95 84q5-7 11 0" fill="none" stroke-width="2.5"/>',
  '<path class="mascot-grin" d="M90 76h21q-1 15-10.5 15T90 76Z" fill="#2b1849" stroke-width="2"/>',
  '</g></g></svg>'
].join('');

function mascot(mood) {
  var node = make('div', null, 'mascot');
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML = mascotDrawing;
  poseMascot(node, mood, mood);
  return node;
}

function poseMascot(node, mood, moment) {
  if (node.getAttribute('data-moment') === moment) return;
  // A new round can have the same result. Refresh the drawing to replay its motion.
  if (node.className === 'mascot mascot--' + mood) node.innerHTML = mascotDrawing;
  node.setAttribute('data-moment', moment);
  node.className = 'mascot mascot--' + mood;
}
