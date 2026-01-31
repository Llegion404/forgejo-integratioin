// Jest setup file for unit tests
// This file is run once before all tests

// Mock fetch globally
// @ts-ignore - Jest provides the fn method
global.fetch = jest.fn();
