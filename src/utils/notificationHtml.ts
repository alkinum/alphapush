import sanitizeHtml from 'sanitize-html';

/** Keep Markdown formatting without allowing message content to run code or style the app. */
export function sanitizeNotificationHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'del'],
    allowedAttributes: {
      a: ['href', 'title'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      code: ['class'],
      pre: ['class'],
      span: ['class'],
    },
    allowedClasses: {
      code: ['hljs', 'language-*'],
      pre: ['code-block'],
      span: ['hljs-*'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
  });
}
