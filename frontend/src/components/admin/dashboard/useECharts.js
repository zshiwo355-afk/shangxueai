/**
 * 共享 ECharts 容器 hook：延迟 init + ResizeObserver，彻底解决"容器初始 0 尺寸 → 图表空白"。
 *
 * 关键点：
 *   1. mount 时如果容器已有尺寸就直接 init；否则等 ResizeObserver 第一次拿到 >0 尺寸再 init。
 *   2. option 通过 ref 暂存，init 时一次性 setOption，避免在 0 尺寸时白绘。
 *   3. 后续 option / window resize / 容器尺寸变化都自动 resize。
 *   4. ECharts 6 的 grid.containLabel 已弃用且默认不注册——本项目改用固定 grid，不再依赖它。
 */
import * as echarts from "echarts/core";
import {
  BarChart,
  LineChart,
  PieChart,
} from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  CanvasRenderer,
]);

export function useECharts(option, deps = []) {
  const containerRef = useRef(null);
  const instanceRef = useRef(null);
  const optionRef = useRef(option);
  optionRef.current = option;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    let inst = null;
    let observer = null;

    const ensureInit = () => {
      if (inst) return;
      const { width, height } = el.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      inst = echarts.init(el);
      instanceRef.current = inst;
      if (optionRef.current) {
        inst.setOption(optionRef.current, true);
      }
    };

    ensureInit();

    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        ensureInit();
        if (inst) inst.resize();
      });
      observer.observe(el);
    }

    const onWindowResize = () => { if (inst) inst.resize(); };
    window.addEventListener("resize", onWindowResize);

    return () => {
      window.removeEventListener("resize", onWindowResize);
      if (observer) observer.disconnect();
      if (inst) inst.dispose();
      instanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (instanceRef.current && option) {
      instanceRef.current.setOption(option, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return containerRef;
}

export { echarts };
