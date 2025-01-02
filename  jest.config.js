// jest.config.js

/*export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  globals: {
    'ts-jest': {
      useESM: true,
    },
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!image-dimensions|.*?)/',  // Allow Jest to transform image-dimensions and all nested modules
  ],
};*/
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  globals: {
    'ts-jest': {
      useESM: true,
    },
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^image-dimensions$': '<rootDir>/__mocks__/image-dimensions.js',  // Mock the image-dimensions module
  },
  transform: {
    '^.+\\.tsx?$': 'babel-jest',  // Use babel-jest for TypeScript files
  },
  transformIgnorePatterns: [
    '/node_modules/(?!image-dimensions)/',
  ],
};

