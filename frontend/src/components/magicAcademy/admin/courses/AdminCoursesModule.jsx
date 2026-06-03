import {
  ArrowLeftOutlined,
  ArrowUpOutlined,
  DownOutlined,
  DownloadOutlined,
  EditOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  List,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";

const { Text } = Typography;

export function buildAdminCoursesTabItems({
  courseAdminState,
  courseAdminActions,
  courseAdminForms,
  courseAdminDeps,
}) {
  const {
    videos,
    adminVideoItems,
    adminVideoColumns,
    adminVideoTotal,
    adminVideoPage,
    adminVideoPageSize,
    selectedAdminVideo,
    selectedAdminVideoRowKeys,
    quizVideoId,
    quizPoints,
    videoSeries,
    selectedSeries,
    selectedSeriesId,
    seriesItemVideoId,
    availableSeriesVideos,
    statsVideoId,
    statsDepartment,
    statsUserId,
    statsDepartmentOptions,
    statsEmployeeOptions,
    statsRows,
    answerRows,
    statsColumns,
    answerColumns,
    superAdminMode,
    whitelist,
    whitelistColumns,
    users,
  } = courseAdminState;

  const {
    setVideoModal,
    setSelectedAdminVideoRowKeys,
    setAdminVideoPage,
    setAdminVideoPageSize,
    setQuizVideoId,
    setPointModal,
    setQuestionModal,
    setQuizImportState,
    setSeriesItemVideoId,
    handlePublishVideo,
    handleDisableVideo,
    handleBatchPublishVideos,
    handleBatchDisableVideos,
    handleBatchDeleteVideos,
    handleSaveWatchConfirmSetting,
    handleAddSeriesItem,
    handleMoveSeriesItem,
    handleStatsSearch,
    handleStatsReset,
    handleExportStats,
    openAdminVideoDetail,
    backToAdminVideoList,
    handleDeleteQuizQuestion,
    handleDeleteQuizPoint,
    openCreateSeriesModal,
    openEditSeriesModal,
    handleDeleteSeries,
    handleRemoveSeriesItem,
    handleCreateWhitelist,
  } = courseAdminActions;

  const {
    watchConfirmForm,
    whitelistForm,
    pointForm,
  } = courseAdminForms;

  const {
    buildMagicQuizImportTemplateUrl,
    getVideoStatusMeta,
    normalizeQuestionType,
    QUESTION_TYPE_LABELS,
    formatTime,
  } = courseAdminDeps;
  const selectedAdminVideoStatus = selectedAdminVideo ? getVideoStatusMeta(selectedAdminVideo) : null;

  return [
    {
      key: "video_manage",
      label: "视频管理",
      children: selectedAdminVideo ? (
        <Space direction="vertical" style={{ width: "100%" }} size={16}>
          <button type="button" className="magic-academy-crumb__back" onClick={backToAdminVideoList}>
            <ArrowLeftOutlined />
            <span>返回视频列表</span>
          </button>
          <Card>
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <div className="magic-video-detail-shell">
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  <Space wrap style={{ justifyContent: "space-between", width: "100%" }}>
                    <Typography.Title level={4} style={{ margin: 0 }}>{selectedAdminVideo.title}</Typography.Title>
                    <Space wrap>
                      <Tag bordered={false} color={selectedAdminVideoStatus?.color || "default"}>
                        {selectedAdminVideoStatus?.text || "未发布"}
                      </Tag>
                      <Tag bordered={false} color={selectedAdminVideo.upload_status === "completed" ? "success" : selectedAdminVideo.upload_status === "failed" ? "error" : "processing"}>
                        上传 {selectedAdminVideo.upload_status || "completed"}
                      </Tag>
                      {selectedAdminVideo.is_required ? <Tag bordered={false} color="gold">必修</Tag> : null}
                    </Space>
                  </Space>
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>{selectedAdminVideo.description || "暂无简介"}</Typography.Paragraph>
                  <courseAdminDeps.ResponsiveVideoPlayer src={courseAdminDeps.buildMagicVideoStreamUrl(selectedAdminVideo.id)} poster={selectedAdminVideo.cover_url || ""} />
                  {selectedAdminVideo.cover_url ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <Text type="secondary">视频封面</Text>
                      <img
                        src={selectedAdminVideo.cover_url}
                        alt={`${selectedAdminVideo.title} 封面`}
                        style={{ width: 220, aspectRatio: "16 / 9", objectFit: "cover", borderRadius: 12, border: "1px solid #f0f0f0" }}
                      />
                    </div>
                  ) : null}
                  <Space wrap>
                    <Text>分类：{selectedAdminVideo.category || "未分类"}</Text>
                    <Text>时长：{courseAdminDeps.formatTime(selectedAdminVideo.duration_seconds || 0)}</Text>
                    <Text>文件大小：{courseAdminDeps.formatFileSize(selectedAdminVideo.file_size || 0)}</Text>
                  </Space>
                  <Space wrap>
                    {selectedAdminVideo.status !== "published" ? (
                      <Button
                        type="primary"
                        loading={courseAdminState.publishingVideoId === selectedAdminVideo.id}
                        disabled={!selectedAdminVideo.can_publish || courseAdminState.disablingVideoId === selectedAdminVideo.id}
                        onClick={() => handlePublishVideo(selectedAdminVideo.id)}
                      >
                        发布
                      </Button>
                    ) : (
                      <Button
                        loading={courseAdminState.disablingVideoId === selectedAdminVideo.id}
                        disabled={courseAdminState.publishingVideoId === selectedAdminVideo.id}
                        onClick={() => handleDisableVideo(selectedAdminVideo.id)}
                      >
                        下架
                      </Button>
                    )}
                    <Button icon={<EditOutlined />} onClick={() => setVideoModal(selectedAdminVideo)}>编辑视频</Button>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setPointModal({})}>新增节点</Button>
                  </Space>
                </Space>
              </div>
            </Space>
          </Card>
          <List
            grid={{ gutter: 16, xs: 1, md: 2 }}
            dataSource={quizPoints}
            locale={{ emptyText: "当前视频还没有配置答题节点" }}
            renderItem={(point) => (
              <List.Item>
                <Card
                  title={`节点 ${formatTime(point.trigger_second)}`}
                  extra={(
                    <Space>
                      <Button size="small" onClick={() => { pointForm.setFieldsValue(point); setPointModal(point); }}>编辑节点</Button>
                      <Button size="small" onClick={() => window.open(buildMagicQuizImportTemplateUrl("xlsx"), "_blank", "noopener,noreferrer")}>下载模板</Button>
                      <Button size="small" onClick={() => setQuizImportState({ open: true, pointId: point.id, source: "upload" })}>Excel导入</Button>
                      <Button size="small" onClick={() => setQuizImportState({ open: true, pointId: point.id, source: "material" })}>从素材库导入</Button>
                      <Button size="small" onClick={() => setQuestionModal({ pointId: point.id })}>新增题目</Button>
                    </Space>
                  )}
                >
                  <Space wrap style={{ marginBottom: 12 }}>
                    <Tag>题目数 {point.question_count}</Tag>
                    <Tag color={point.enabled ? "success" : "default"}>{point.enabled ? "启用" : "停用"}</Tag>
                    <Tag color="blue">需全部答对</Tag>
                  </Space>
                  <List
                    dataSource={point.questions || []}
                    renderItem={(question) => (
                      <List.Item
                        actions={[
                          <Button key="edit" size="small" onClick={() => setQuestionModal({ ...question, pointId: point.id })}>编辑</Button>,
                          <Popconfirm key="del" title="删除题目？" onConfirm={() => handleDeleteQuizQuestion(question.id, selectedAdminVideo.id)}>
                            <Button size="small" danger>删除</Button>
                          </Popconfirm>,
                        ]}
                      >
                        <List.Item.Meta
                          title={`${QUESTION_TYPE_LABELS[normalizeQuestionType(question.question_type)] || question.question_type} · ${question.stem}`}
                          description={`答案：${(question.correct_answers || []).join(" / ") || "无"}`}
                        />
                      </List.Item>
                    )}
                  />
                  <div style={{ marginTop: 12 }}>
                    <Popconfirm title="删除整个答题节点？" onConfirm={() => handleDeleteQuizPoint(point.id, selectedAdminVideo.id)}>
                      <Button danger size="small">删除节点</Button>
                    </Popconfirm>
                  </div>
                </Card>
              </List.Item>
            )}
          />
        </Space>
      ) : (
        <>
          <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Space wrap>
              <span style={{ color: "var(--text-mute)" }}>共 {videos.length} 个视频</span>
              <Button disabled={!selectedAdminVideoRowKeys.length} onClick={handleBatchPublishVideos}>批量发布</Button>
              <Button disabled={!selectedAdminVideoRowKeys.length} onClick={handleBatchDisableVideos}>批量下架</Button>
              <Popconfirm
                title="确认批量删除选中的视频？"
                onConfirm={handleBatchDeleteVideos}
                okText="确认删除"
                cancelText="取消"
                disabled={!selectedAdminVideoRowKeys.length}
              >
                <Button danger disabled={!selectedAdminVideoRowKeys.length}>批量删除</Button>
              </Popconfirm>
            </Space>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setVideoModal({})}>新增视频</Button>
          </div>
          <Table
            rowKey="id"
            dataSource={adminVideoItems}
            columns={adminVideoColumns}
            rowSelection={{
              selectedRowKeys: selectedAdminVideoRowKeys,
              onChange: setSelectedAdminVideoRowKeys,
            }}
            pagination={{
              current: adminVideoPage,
              pageSize: adminVideoPageSize,
              total: adminVideoTotal,
              showSizeChanger: true,
              pageSizeOptions: ["8", "16", "32", "64"],
              onChange: (pageValue, sizeValue) => {
                setAdminVideoPage(pageValue);
                setAdminVideoPageSize(sizeValue);
              },
            }}
          />
        </>
      ),
    },
    {
      key: "quiz",
      label: "视频答题配置",
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size={16}>
          <Card className="magic-quiz-header-card">
            <div className="magic-quiz-header">
              <div className="magic-quiz-header__left">
                <Text>选择视频：</Text>
                <Select
                  style={{ minWidth: 320 }}
                  value={quizVideoId}
                  onChange={setQuizVideoId}
                  options={videos.map((item) => ({ value: item.id, label: item.title }))}
                />
              </div>
              <Button type="primary" onClick={() => { pointForm.resetFields(); setPointModal({}); }}>新增节点</Button>
            </div>
          </Card>
          <Card className="magic-quiz-watch-card">
            <div className="magic-quiz-watch-card__head">
              <div>
                <div className="magic-quiz-watch-card__title">观看确认弹窗</div>
                <div className="magic-quiz-watch-card__desc">该配置按视频生效，对当前选中的整条视频统一应用。</div>
              </div>
              <Button type="primary" size="small" onClick={handleSaveWatchConfirmSetting}>保存配置</Button>
            </div>
            <Form
              form={watchConfirmForm}
              layout="vertical"
              preserve={false}
              initialValues={{
                enabled: false,
                interval_seconds: 300,
                message: "请确认你正在观看视频",
                button_text: "继续学习",
              }}
            >
              <div className="magic-quiz-watch-card__grid">
                <Form.Item label="启用确认弹窗" name="enabled" valuePropName="checked">
                  <Switch />
                </Form.Item>
                <Form.Item label="弹窗间隔（秒）" name="interval_seconds" rules={[{ required: true, message: "请输入间隔秒数" }]}>
                  <InputNumber min={30} max={86400} style={{ width: "100%" }} />
                </Form.Item>
                <Form.Item label="弹窗文案" name="message" rules={[{ required: true, message: "请输入弹窗文案" }]}>
                  <Input placeholder="请确认你正在观看视频" />
                </Form.Item>
                <Form.Item label="按钮文案" name="button_text" rules={[{ required: true, message: "请输入按钮文案" }]}>
                  <Input placeholder="继续学习" />
                </Form.Item>
              </div>
            </Form>
          </Card>
          <List
            grid={{ gutter: 16, xs: 1, md: 1, xl: 2 }}
            dataSource={quizPoints}
            renderItem={(point) => (
              <List.Item>
                <Card
                  className="magic-quiz-point-card"
                  title={`节点 ${formatTime(point.trigger_second)}`}
                  extra={(
                    <Space wrap>
                      <Button size="small" onClick={() => { pointForm.setFieldsValue(point); setPointModal(point); }}>编辑节点</Button>
                      <Button size="small" onClick={() => window.open(buildMagicQuizImportTemplateUrl("xlsx"), "_blank", "noopener,noreferrer")}>下载模板</Button>
                      <Button size="small" onClick={() => setQuizImportState({ open: true, pointId: point.id, source: "upload" })}>Excel导入</Button>
                      <Button size="small" onClick={() => setQuizImportState({ open: true, pointId: point.id, source: "material" })}>从素材库导入</Button>
                      <Button size="small" onClick={() => setQuestionModal({ pointId: point.id })}>新增题目</Button>
                    </Space>
                  )}
                >
                  <div className="magic-quiz-point-card__meta">
                    <Tag>题目数 {point.question_count}</Tag>
                    <Tag color={point.enabled ? "success" : "default"}>{point.enabled ? "启用" : "停用"}</Tag>
                    <Tag color="blue">需全部答对</Tag>
                  </div>
                  <List
                    className="magic-quiz-question-list"
                    dataSource={point.questions || []}
                    renderItem={(question) => (
                      <List.Item
                        actions={[
                          <Button key="edit" size="small" onClick={() => setQuestionModal({ ...question, pointId: point.id })}>编辑</Button>,
                          <Popconfirm key="del" title="删除题目？" onConfirm={() => handleDeleteQuizQuestion(question.id, quizVideoId)}>
                            <Button size="small" danger>删除</Button>
                          </Popconfirm>,
                        ]}
                      >
                        <List.Item.Meta
                          title={`${QUESTION_TYPE_LABELS[normalizeQuestionType(question.question_type)] || question.question_type} · ${question.stem}`}
                          description={`答案：${(question.correct_answers || []).join(" / ") || "无"}`}
                        />
                      </List.Item>
                    )}
                  />
                  <div style={{ marginTop: 12 }}>
                    <Popconfirm title="删除整个答题节点？" onConfirm={() => handleDeleteQuizPoint(point.id, quizVideoId)}>
                      <Button danger size="small">删除节点</Button>
                    </Popconfirm>
                  </div>
                </Card>
              </List.Item>
            )}
          />
        </Space>
      ),
    },
    {
      key: "series",
      label: "视频系列管理",
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size={16}>
          <Card
            title="系列列表"
            extra={<Button type="primary" icon={<PlusOutlined />} onClick={openCreateSeriesModal}>新增系列</Button>}
          >
            <Table
              rowKey="id"
              dataSource={videoSeries}
              pagination={false}
              rowSelection={{
                type: "radio",
                selectedRowKeys: selectedSeriesId ? [selectedSeriesId] : [],
                onChange: (keys) => courseAdminActions.setSelectedSeriesId(keys[0] || null),
              }}
              columns={[
                { title: "系列名称", dataIndex: "title" },
                { title: "描述", dataIndex: "description", render: (value) => value || "—" },
                { title: "视频数", render: (_, row) => row.items?.length || 0 },
                { title: "顺序解锁", dataIndex: "sequential_unlock_enabled", render: (value) => value ? "开启" : "关闭" },
                { title: "状态", dataIndex: "enabled", render: (value) => value ? <Tag color="success">启用</Tag> : <Tag>停用</Tag> },
                {
                  title: "操作",
                  render: (_, row) => (
                    <Space>
                      <Button size="small" onClick={() => openEditSeriesModal(row)}>编辑</Button>
                      <Popconfirm title="删除该系列？系列下视频只会解除关系，不会删除视频。" onConfirm={() => handleDeleteSeries(row.id)}>
                        <Button size="small" danger>删除</Button>
                      </Popconfirm>
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
          {selectedSeries ? (
            <Card title={`系列视频 · ${selectedSeries.title}`}>
              <Space wrap style={{ marginBottom: 16 }}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  style={{ width: 320 }}
                  placeholder="选择要加入系列的视频"
                  value={seriesItemVideoId || undefined}
                  onChange={(value) => setSeriesItemVideoId(value || null)}
                  options={availableSeriesVideos.map((item) => ({ value: item.id, label: item.title }))}
                />
                <Button type="primary" onClick={handleAddSeriesItem}>加入系列</Button>
              </Space>
              <Table
                rowKey="video_id"
                dataSource={selectedSeries.items || []}
                pagination={false}
                columns={[
                  { title: "顺序", dataIndex: "sort_order", width: 90 },
                  { title: "视频", dataIndex: "title" },
                  { title: "分类", dataIndex: "category", render: (value) => value || "—" },
                  {
                    title: "操作",
                    render: (_, row, index) => (
                      <Space>
                        <Button size="small" disabled={index === 0} icon={<ArrowUpOutlined />} onClick={() => handleMoveSeriesItem(row.video_id, -1)} />
                        <Button size="small" disabled={index === (selectedSeries.items?.length || 0) - 1} icon={<DownOutlined />} onClick={() => handleMoveSeriesItem(row.video_id, 1)} />
                        <Popconfirm title="确认移出该系列？" onConfirm={() => handleRemoveSeriesItem(selectedSeries.id, row.video_id)}>
                          <Button size="small" danger>移除</Button>
                        </Popconfirm>
                      </Space>
                    ),
                  },
                ]}
              />
            </Card>
          ) : null}
        </Space>
      ),
    },
    {
      key: "stats",
      label: "视频学习统计",
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size={16}>
          <Card>
            <Space wrap>
              <Text>选择视频：</Text>
              <Select style={{ minWidth: 260 }} value={statsVideoId} onChange={courseAdminActions.setStatsVideoId} options={videos.map((item) => ({ value: item.id, label: item.title }))} />
              <Select
                mode="multiple"
                allowClear
                style={{ width: 180 }}
                placeholder="选择部门"
                value={statsDepartment}
                onChange={(value) => courseAdminActions.setStatsDepartment(value || [])}
                options={statsDepartmentOptions}
                maxTagCount="responsive"
              />
              <Select
                mode="multiple"
                allowClear
                showSearch
                optionFilterProp="label"
                style={{ width: 280 }}
                placeholder="选择员工"
                value={statsUserId}
                onChange={(value) => courseAdminActions.setStatsUserId(value || [])}
                options={statsEmployeeOptions}
                maxTagCount="responsive"
              />
              <Button type="primary" onClick={handleStatsSearch}>查询</Button>
              <Button onClick={handleStatsReset}>重置</Button>
              <Button icon={<DownloadOutlined />} disabled={!statsVideoId} onClick={() => handleExportStats("progress")}>导出学习统计</Button>
              <Button icon={<DownloadOutlined />} disabled={!statsVideoId} onClick={() => handleExportStats("answers")}>导出答题详情</Button>
            </Space>
          </Card>
          <Card title="学习统计">
            <Table rowKey="user_id" dataSource={statsRows} columns={statsColumns} pagination={{ pageSize: 8 }} />
          </Card>
          <Card title="答题详情">
            <Table rowKey={(row) => `${row.name}-${row.submitted_at}-${row.question}`} dataSource={answerRows} columns={answerColumns} pagination={{ pageSize: 8 }} />
          </Card>
        </Space>
      ),
    },
    ...(superAdminMode ? [{
      key: "whitelist",
      label: "视频限制白名单",
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size={16}>
          <Card title="添加白名单">
            <Form form={whitelistForm} layout="inline" onFinish={handleCreateWhitelist}>
              <Form.Item name="video_id" rules={[{ required: true, message: "请选择视频" }]}>
                <Select style={{ width: 240 }} placeholder="选择视频" options={videos.map((item) => ({ value: item.id, label: item.title }))} />
              </Form.Item>
              <Form.Item name="user_id" rules={[{ required: true, message: "请选择用户" }]}>
                <Select style={{ width: 240 }} placeholder="选择用户" options={users.filter((item) => item.role === "user").map((item) => ({ value: item.id, label: `${item.real_name || item.display_name || item.username} (${item.username})` }))} />
              </Form.Item>
              <Form.Item name="note">
                <Input style={{ width: 220 }} placeholder="备注（选填）" />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit">添加</Button>
              </Form.Item>
            </Form>
          </Card>
          <Card>
            <Table rowKey="id" dataSource={whitelist} columns={whitelistColumns} pagination={{ pageSize: 8 }} />
          </Card>
        </Space>
      ),
    }] : []),
  ];
}
