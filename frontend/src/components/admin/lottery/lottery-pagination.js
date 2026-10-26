export const LOTTERY_PAGE_OPTIONS = {
  showSizeChanger: true,
  showQuickJumper: true,
  pageSizeOptions: [10, 20, 50, 100],
};

const positiveInteger = (value, fallback) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
const responseItems = (data) => Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];

export function lotteryPageRequest(current, pageSize, previousPageSize = pageSize) {
  const size = Math.min(100, positiveInteger(pageSize, 10));
  return { current: size === Number(previousPageSize) ? positiveInteger(current, 1) : 1, pageSize: size };
}

// An emptied last page is reloaded at its new last page. If data shrinks again
// during that retry, page 1 is a bounded, safe fallback instead of a retry loop.
export async function loadLotteryPage(fetchPage, requestedPage, isCurrent = () => true) {
  let current = requestedPage.current;
  const pageSize = requestedPage.pageSize;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!isCurrent()) return null;
    const data = await fetchPage({ page: current, page_size: pageSize });
    if (!isCurrent()) return null;
    const items = responseItems(data);
    const total = Number.isFinite(Number(data?.total)) && Number(data.total) >= 0 ? Number(data.total) : items.length;
    const lastPage = Math.max(1, Math.ceil(total / pageSize));
    if (current > lastPage) {
      current = attempt === 0 ? lastPage : 1;
      continue;
    }
    return { data, items, pagination: { current, pageSize, total } };
  }
  return null;
}

// The activity selector searches locally, so load every API page, not only the
// newest 100 activities. A superseded filter/refresh stops requesting more pages.
export async function loadAllLotteryCampaigns(fetchPage, isCurrent = () => true) {
  const items = [];
  const seen = new Set();
  const pageSize = 100;
  for (let page = 1; ; page += 1) {
    if (!isCurrent()) return null;
    const data = await fetchPage({ page, page_size: pageSize });
    if (!isCurrent()) return null;
    const batch = responseItems(data);
    for (const item of batch) {
      if (!seen.has(String(item.id))) {
        seen.add(String(item.id));
        items.push(item);
      }
    }
    const total = Number(data?.total);
    if (!batch.length || (Number.isFinite(total) ? page * pageSize >= total : batch.length < pageSize)) return items;
  }
}
