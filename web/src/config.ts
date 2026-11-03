export type SheetConfig = {
  name: string
  suffix: string
  export_columns: string[]
}

export const APP_CONFIG = {
  filter_column: 'Đội',
  header_row: 2,
  skip_teams: ['#N/A', ''] as string[],
  sheets: [
    {
      name: 'XLSC_TON',
      suffix: 'XLSC',
      export_columns: [
        'Mã Khiếu Nại',
        'Thuê bao',
        'Người khiếu nại',
        'Ngày tiếp nhận',
        'Thể loại',
        'Huyện',
        'MÃ TỦ',
        'Tính KPI',
        'Phân loại SC',
        'TG tồn',
        'NVKT',
        'Họ tên',
        'Đội',
      ],
    },
    {
      name: 'TKM_TON',
      suffix: 'TKM',
      export_columns: [
        'Loại yêu cầu',
        'Dịch vụ',
        'Tên khách hàng',
        'Account',
        'Địa chỉ lắp đặt',
        'Ngày tiếp nhận yêu cầu',
        'Ghi chú (Đầu mối liên hệ xác nhận)',
        'Tích hẹn',
        'Thời gian tồn ( giờ )',
        'Hủy',
        'Huyện',
        'Nhân viên',
        'Họ Tên',
        'Đội',
      ],
    },
  ] as SheetConfig[],
} as const
