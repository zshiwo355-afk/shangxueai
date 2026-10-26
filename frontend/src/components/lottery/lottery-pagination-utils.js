export const LOTTERY_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export function lotteryPageChange(previous, current, pageSize) {
  const size = LOTTERY_PAGE_SIZE_OPTIONS.includes(Number(pageSize)) ? Number(pageSize) : previous.pageSize;
  return {
    ...previous,
    current: size === previous.pageSize ? Math.max(1, Math.trunc(Number(current) || 1)) : 1,
    pageSize: size,
  };
}

export function lotteryPageFromResponse(data, current, pageSize) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const total = Math.max(0, Math.trunc(Number(data?.total) || 0));
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  return { current: Math.min(Math.max(1, current), lastPage), pageSize, total, items };
}
