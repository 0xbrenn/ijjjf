declare module 'lightweight-charts' {
  export function createChart(container: HTMLElement, options?: any): any;
  export enum ColorType {
    Solid = 'solid',
    VerticalGradient = 'gradient'
  }
  export enum CrosshairMode {
    Normal = 0,
    Magnet = 1
  }
  export type Time = number | string;
  export interface IChartApi {
    addCandlestickSeries(options?: any): any;
    addLineSeries(options?: any): any;
    addAreaSeries(options?: any): any;
    addHistogramSeries(options?: any): any;
    remove(): void;
    resize(width: number, height: number): void;
    timeScale(): any;
    priceScale(id?: string): any;
    applyOptions(options: any): void;
    takeScreenshot(): any;
  }
  export interface ISeriesApi<T> {
    setData(data: any[]): void;
    update(data: any): void;
    createPriceLine(options: any): any;
  }
}