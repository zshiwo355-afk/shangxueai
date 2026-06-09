import { Card, DatePicker, Form, Input, Modal, Select, Space, Switch, Typography } from "antd";

import DepartmentUserTreeSelect from "../../../common/DepartmentUserTreeSelect";
import { READING_SERIES_STATUS_OPTIONS } from "../../magicAcademyPageConfig";

const { RangePicker } = DatePicker;
const { Text } = Typography;
const JOB_LEVEL_OPTIONS = [
  { value: "M线", label: "M线" },
  { value: "P线", label: "P线" },
  { value: "L线", label: "L线" },
];

export default function ReadingSeriesModal({
  form,
  support,
  positionOptions = [],
  employeeUsers = [],
  employmentStatusOptions = [],
}) {
  return (
    <Modal
      open={!!support.readingSeriesModal}
      title={support.readingSeriesModal?.id ? "编辑读书系列" : "新增读书系列"}
      onCancel={() => {
        if (support.readingSeriesSubmitting) return;
        if (typeof support.closeReadingSeriesModal === "function") {
          support.closeReadingSeriesModal();
          return;
        }
        support.setReadingSeriesModal?.(null);
      }}
      onOk={support.handleSubmitReadingSeries}
      confirmLoading={support.readingSeriesSubmitting}
      okText="保存"
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ status: "draft" }}
      >
        <Form.Item name="title" label="系列名称" rules={[{ required: true, message: "请输入系列名称" }]}>
          <Input placeholder="例如：新人三十天读书计划" />
        </Form.Item>
        <Form.Item name="description" label="系列说明">
          <Input.TextArea rows={3} placeholder="可填写该系列的阅读目标、适用范围或备注" />
        </Form.Item>
        <Form.Item name="date_range" label="计划周期" extra="用于限制和辅助选择该系列下的读书内容日期，不会自动生成推送任务。">
          <RangePicker style={{ width: "100%" }} />
        </Form.Item>
        <Card size="small" title="默认派发对象" style={{ marginBottom: 16 }}>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Text type="secondary">新增读书内容选择该系列时，会默认带出这些派发对象；单条内容仍可单独调整。</Text>
            <Form.Item name="target_all" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch checkedChildren="全部员工" unCheckedChildren="非全员" />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(prev, next) => prev.target_all !== next.target_all}>
              {({ getFieldValue }) => getFieldValue("target_all") ? null : (
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <Form.Item name="target_department_ids" label="部门" style={{ marginBottom: 0 }}>
                    <DepartmentUserTreeSelect
                      users={employeeUsers}
                      placeholder="选择部门会自动包含下级员工，可展开后取消个人"
                    />
                  </Form.Item>
                  <Form.Item name="target_position_ids" label="岗位" style={{ marginBottom: 0 }}>
                    <Select mode="multiple" allowClear showSearch optionFilterProp="label" options={positionOptions} placeholder="选择岗位" />
                  </Form.Item>
                  <Form.Item name="target_job_level_ids" label="职级" style={{ marginBottom: 0 }}>
                    <Select mode="multiple" allowClear options={JOB_LEVEL_OPTIONS} placeholder="选择 M线 / P线 / L线" />
                  </Form.Item>
                  <Form.Item name="target_employment_status_ids" label="在职状态" style={{ marginBottom: 0 }}>
                    <Select
                      mode="multiple"
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      options={employmentStatusOptions.map((item) => ({ value: item, label: item }))}
                      placeholder={employmentStatusOptions.length ? "选择在职状态" : "暂无可用在职状态"}
                      disabled={!employmentStatusOptions.length}
                    />
                  </Form.Item>
                  <Form.Item name="target_user_ids" label="指定人员" style={{ marginBottom: 0 }}>
                    <Select
                      mode="multiple"
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      options={employeeUsers.map((item) => ({
                        value: item.id,
                        label: `${item.real_name || item.display_name || item.username} (${item.username})`,
                      }))}
                      placeholder="搜索并选择员工"
                    />
                  </Form.Item>
                </Space>
              )}
            </Form.Item>
          </Space>
        </Card>
        <Form.Item
          name="status"
          label="状态"
          rules={[{ required: true, message: "请选择状态" }]}
          extra="草稿：准备中；启用：可用于新增读书内容；暂停：暂时不用于新增内容；已归档：长期不用，保留历史数据。"
        >
          <Select options={READING_SERIES_STATUS_OPTIONS} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
