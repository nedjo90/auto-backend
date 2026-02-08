export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'auth',
        'user',
        'listing',
        'consent',
        'config',
        'messaging',
        'moderation',
        'db',
        'api',
        'middleware',
        'deps',
        'release',
      ],
    ],
    'subject-case': [2, 'never', ['start-case', 'pascal-case', 'upper-case']],
  },
};
