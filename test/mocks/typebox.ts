const identity = (x: any) => x;
const withMeta = (_meta: any) => identity;

export const Type = {
	Object: identity,
	String: withMeta,
	Number: withMeta,
	Optional: identity,
	Array: (item: any, meta?: any) => item,
	Union: (items: any[], meta?: any) => items[0],
	Literal: identity,
};

export type Static<T> = any;
