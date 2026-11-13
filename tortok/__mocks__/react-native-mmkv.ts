// An in-memory stand-in for react-native-mmkv in unit tests (the native
// module can't load under Node). Every instance shares one map, exported as
// `__data` so tests can seed or inspect it. Tests opt in with
// `jest.mock('react-native-mmkv')`.

export const __data = new Map<string, string | number>();

export const MMKV = jest.fn().mockImplementation(() => ({
  getString: (key: string) => {
    const v = __data.get(key);
    return typeof v === 'string' ? v : undefined;
  },
  getNumber: (key: string) => {
    const v = __data.get(key);
    return typeof v === 'number' ? v : undefined;
  },
  set: (key: string, value: string | number) => { __data.set(key, value); },
  delete: (key: string) => { __data.delete(key); },
  getAllKeys: () => [...__data.keys()],
}));
