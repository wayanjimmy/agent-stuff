export class Container {
	addChild(_child: any) {}
}
export class Text {
	constructor(
		public text: string,
		public x: number,
		public y: number,
	) {}
}
export class Markdown {
	constructor(
		public text: string,
		public x: number,
		public y: number,
		public theme: any,
	) {}
}
export class Spacer {
	constructor(public size: number) {}
}
export function matchesKey(_data: string, _key: string) {
	return false;
}
export function truncateToWidth(s: string, _w: number) {
	return s;
}
export function visibleWidth(s: string) {
	return s.length;
}
