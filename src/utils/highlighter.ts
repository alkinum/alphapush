import * as shiki from 'shiki';

const highlighter = await shiki.createHighlighter({
  themes: ['github-dark'],
  langs: ['javascript', 'typescript', 'python', 'go', 'rust', 'c', 'c#', 'c++'],
});

export { highlighter };
