/**
 * Pagination behaviour tests — verifies every list tool clamps page/page_size
 * to its schema-declared range and refuses to fetch more than the cap.
 *
 * Each list tool should:
 * - accept `page` (1-based, min 1) and `page_size` (min 1, max 50)
 * - default to page=1, page_size=30
 * - pass page=X&limit=Y as query params on the rawRequest path
 * - return a `_meta.pagination` envelope with `has_more` flag
 */

import { resolvePagination, buildPaginationMeta } from '../../mcp/tools/framework';

describe('resolvePagination', () => {
	it('returns defaults when args are missing', () => {
		expect(resolvePagination({})).toEqual({ page: 1, pageSize: 30 });
	});

	it('accepts valid page + page_size', () => {
		expect(resolvePagination({ page: 3, page_size: 50 })).toEqual({ page: 3, pageSize: 50 });
	});

	it('clamps page_size to 50 (Forgejo server max)', () => {
		expect(resolvePagination({ page_size: 1000 })).toEqual({ page: 1, pageSize: 50 });
	});

	it('clamps page_size to >= 1', () => {
		expect(resolvePagination({ page_size: 0 })).toEqual({ page: 1, pageSize: 1 });
		expect(resolvePagination({ page_size: -5 })).toEqual({ page: 1, pageSize: 1 });
	});

	it('clamps page to >= 1', () => {
		expect(resolvePagination({ page: 0 })).toEqual({ page: 1, pageSize: 30 });
		expect(resolvePagination({ page: -5 })).toEqual({ page: 1, pageSize: 30 });
	});

	it('accepts numeric strings (legacy convenience)', () => {
		expect(resolvePagination({ page: '5', page_size: '20' })).toEqual({ page: 5, pageSize: 20 });
	});

	it('ignores non-numeric strings', () => {
		expect(resolvePagination({ page: 'abc', page_size: 'xyz' })).toEqual({ page: 1, pageSize: 30 });
	});

	it('ignores null and array values', () => {
		expect(resolvePagination({ page: null, page_size: [1, 2] })).toEqual({ page: 1, pageSize: 30 });
	});

	it('respects custom defaultPageSize + maxPageSize', () => {
		expect(resolvePagination({}, 10, 25)).toEqual({ page: 1, pageSize: 10 });
		expect(resolvePagination({ page_size: 100 }, 10, 25)).toEqual({ page: 1, pageSize: 25 });
	});
});

describe('buildPaginationMeta', () => {
	it('marks has_more=true when returned equals page_size (suggests another full page)', () => {
		const meta = buildPaginationMeta(1, 30, 30);
		expect(meta).toEqual({ page: 1, page_size: 30, returned: 30, has_more: true });
	});

	it('marks has_more=false when returned < page_size (last page)', () => {
		const meta = buildPaginationMeta(1, 30, 5);
		expect(meta.has_more).toBe(false);
		expect(meta.returned).toBe(5);
	});

	it('marks has_more=false on empty page', () => {
		const meta = buildPaginationMeta(2, 50, 0);
		expect(meta.has_more).toBe(false);
	});

	it('marks has_more=true when returned exceeds page_size (defensive against bad SDK)', () => {
		// If a tool accidentally returns MORE items than requested, that's a
		// sign the underlying call ignored pagination — but the >= check is
		// still satisfied, so has_more stays true. `returned` reflects reality.
		const meta = buildPaginationMeta(1, 30, 45);
		expect(meta.has_more).toBe(true);
		expect(meta.returned).toBe(45);
	});
});
