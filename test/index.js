const { JSDOM } = require('jsdom');
const SelectorEvaluator = require('../lib');

function html(content) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Document</title>
</head>
<body>
${content}
</body>
</html>
  `;
}

const jsdom = new JSDOM(
  html(`
  <div class="container">
    <div class="gallery">
      <article>Item</article>
      <article>Item</article>
      <article class="bad">Item</article>
      <article class="bad">Item</article>
      <article>Item</article>
      <article>Item</article>
    </div>
  </div>
`),
);

const { window } = jsdom;

const selector = SelectorEvaluator.create({
  getTagName: node => node.tagName,
  getContent: node => node.textContent,
  getID: node => node.id,
  hasClass: (node, className) => node.classList.contains(className),
  getParent: node => node.parentElement,
  getChildren: node => node.children,
  getAttribute: (node, name) => node.getAttribute(node, name),
  getPreviouSibling: node => node.previousElementSibling,
  getNextSibling: node => node.nextElementSibling,
});

console.log(selector.querySelectorAll(window.document.body, '.container > .gallery > .bad'));
