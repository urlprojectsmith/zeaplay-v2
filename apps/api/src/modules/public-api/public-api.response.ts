export function publicData<T>(data: T) {
  return { data };
}

export function publicList<T>(result: {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}) {
  return {
    data: result.items,
    meta: {
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
    },
  };
}
