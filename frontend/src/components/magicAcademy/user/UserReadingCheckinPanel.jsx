import { BookOutlined, CalendarOutlined, ReadOutlined, UploadOutlined } from "@ant-design/icons";
import { Button, Calendar, Input, Popconfirm, Space, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { useRef, useState } from "react";

import MagicAcademyEmptyState from "../shared/MagicAcademyEmptyState";
import {
  getAudioDayStatus,
  getTodayText,
  renderAudioStatusTag,
} from "../magicAcademyShared";
import ReadingContentCard from "./ReadingContentCard";

const { Text } = Typography;

export default function UserReadingCheckinPanel({ support, makeupSetting }) {
  const [activeSection, setActiveSection] = useState("upload");
  const uploadSectionRef = useRef(null);
  const uploadActionRef = useRef(null);
  const calendarSectionRef = useRef(null);
  const historySectionRef = useRef(null);
  const primaryUploadItemId = support.selectedReadingContents.find((item) => !item.completed)?.id
    ?? support.selectedReadingContents[0]?.id;

  const navItems = [
    {
      key: "upload",
      label: "录音上传",
      description: "提交当天读书打卡",
      icon: <UploadOutlined />,
      ref: uploadSectionRef,
    },
    {
      key: "calendar",
      label: "上传日历",
      description: "查看每日上传状态",
      icon: <CalendarOutlined />,
      ref: calendarSectionRef,
    },
    {
      key: "history",
      label: "历史记录",
      description: "回看我的上传明细",
      icon: <BookOutlined />,
      ref: historySectionRef,
    },
  ];

  const handleNavigate = (key, targetRef) => {
    setActiveSection(key);
    const actionTarget = key === "upload" ? uploadActionRef.current : null;
    const target = actionTarget || targetRef.current;
    target?.scrollIntoView({
      behavior: "smooth",
      block: actionTarget ? "center" : "start",
      inline: "nearest",
    });
  };

  return (
    <div className="reading-checkin-page">
      <div className="reading-checkin-nav" role="tablist" aria-label="读书打卡功能导航">
        {navItems.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`reading-checkin-nav__item${activeSection === item.key ? " is-active" : ""}`}
            onClick={() => handleNavigate(item.key, item.ref)}
          >
            <span className="reading-checkin-nav__icon">{item.icon}</span>
            <span className="reading-checkin-nav__content">
              <strong>{item.label}</strong>
              <span>{item.description}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="workspace-dual workspace-dual--lined">
        <div className="workspace-panel reading-checkin-main">
          <section ref={uploadSectionRef} className="reading-checkin-section">
            <div className="workspace-panel" style={{ marginBottom: 16 }}>
              <div className="workspace-panel__head">
                <Space>
                  <ReadOutlined />
                  <strong>{support.myAudioSelectedDate === getTodayText() ? "今日读书内容" : `${support.myAudioSelectedDate} 读书内容`}</strong>
                </Space>
              </div>
              {support.selectedReadingContents.length > 0 ? (
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  {support.selectedReadingContents.map((item) => (
                    <ReadingContentCard
                      key={item.id}
                      item={item}
                      statusColor={item.current_status === "已完成" ? "success" : item.current_status === "已过补卡时间" ? "default" : "processing"}
                      canMakeup={!!support.myAudioMakeupMap[item.id]?.can_makeup}
                      makeupReason={support.myAudioMakeupMap[item.id]?.reason || ""}
                      actionRef={item.id === primaryUploadItemId ? uploadActionRef : undefined}
                      onSubmit={({ audioFile, imageFile }) => support.handleUploadAudioRecord({
                        readingItem: item,
                        audioFile,
                        imageFile,
                      })}
                      onSubmitMakeup={({ audioFile, imageFile }) => support.handleSubmitAudioMakeup(item, { audioFile, imageFile })}
                    />
                  ))}
                </Space>
              ) : (
                <MagicAcademyEmptyState description={support.myAudioSelectedDate === getTodayText() ? "今日暂无读书内容" : "该日期暂无读书内容"} />
              )}
            </div>

            <div className="workspace-panel__head">
              <Space>
                <UploadOutlined />
                <strong>本页打卡备注</strong>
              </Space>
              <Tag bordered={false} color={support.todayUploadedAudio ? "success" : "default"}>
                {support.todayUploadedAudio ? "已有内容完成" : "待完成"}
              </Tag>
            </div>
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Input.TextArea
                rows={2}
                placeholder="备注（选填）"
                value={support.audioRemark}
                onChange={(e) => support.setAudioRemark(e.target.value)}
              />
              <Text type="secondary">在每条读书内容卡片里单独提交，录音和图片至少传一项。录音支持 mp3、m4a、wav、aac、amr、webm、ogg（≤50MB）；图片支持 jpg、png、webp（≤10MB）。</Text>
            </Space>
          </section>

          <section ref={historySectionRef} className="reading-checkin-section">
            <div className="workspace-panel reading-checkin-history-panel" style={{ marginTop: 16 }}>
              <div className="workspace-panel__head">
                <Space>
                  <CalendarOutlined />
                  <strong>我的上传记录</strong>
                </Space>
              </div>
              <Table
                className="reading-checkin-history-table"
                rowKey="id"
                size="middle"
                dataSource={support.myAudios}
                pagination={{ pageSize: 8 }}
                scroll={{ x: 720 }}
                columns={[
                  {
                    title: "文件名",
                    dataIndex: "file_name",
                    ellipsis: { showTitle: true },
                    render: (v) => v || "—",
                  },
                  { title: "备注", dataIndex: "remark", width: 120, ellipsis: true, render: (v) => v || "—" },
                  { title: "状态", dataIndex: "status", width: 100, render: (v) => <Tag bordered={false} color="success">{v || "已上传"}</Tag> },
                  { title: "上传时间", dataIndex: "uploaded_time", width: 170, render: (v) => v?.replace("T", " ").slice(0, 19) || "—" },
                  {
                    title: "操作",
                    width: 90,
                    fixed: "right",
                    render: (_, row) => (
                      <Popconfirm title="确认删除这条录音记录？" onConfirm={() => support.handleDeleteAudioRecord(row.id)}>
                        <Button size="small" danger>删除</Button>
                      </Popconfirm>
                    ),
                  },
                ]}
              />
            </div>
          </section>
        </div>

        <aside className="workspace-panel workspace-panel--aside reading-checkin-side">
          <section ref={calendarSectionRef} className="reading-checkin-section">
            <div className="workspace-panel reading-checkin-calendar-panel">
              <div className="workspace-panel__head">
                <Space>
                  <CalendarOutlined />
                  <strong>上传日历</strong>
                </Space>
              </div>
              <Calendar
                className="reading-checkin-calendar"
                fullscreen={false}
                value={dayjs(support.myAudioSelectedDate)}
                onSelect={(value) => support.setMyAudioSelectedDate(value.format("YYYY-MM-DD"))}
                onPanelChange={(value) => {
                  support.setMyAudioMonth(value.format("YYYY-MM"));
                  support.setMyAudioSelectedDate(value.startOf("month").format("YYYY-MM-DD"));
                }}
                cellRender={support.renderEmployeeAudioCell}
              />
            </div>

            <div className="workspace-panel reading-checkin-day-record-panel">
              <div className="workspace-panel__head">
                <Space>
                  <BookOutlined />
                  <strong>{support.myAudioSelectedDate || "选中日期"} 的记录</strong>
                </Space>
                {renderAudioStatusTag(
                  getAudioDayStatus(support.myAudioSelectedDate, support.selectedMyAudioDay),
                  support.selectedMyAudioDay?.count || 0,
                  0,
                )}
              </div>
              <div className="workspace-note-block" style={{ marginBottom: 12 }}>
                <strong>补卡说明</strong>
                <p>{makeupSetting.description || "当前未开启补卡"}</p>
                <Text type="secondary">补卡按单条读书内容判断，请在左侧对应内容卡片上操作。</Text>
              </div>
              {support.renderAudioRecordList(support.selectedMyAudioDay?.records || [])}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
