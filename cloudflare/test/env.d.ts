// Vite 的 ?raw：把文件原样当一段字符串引进来（只在测试里用）
declare module "*?raw" {
  const text: string;
  export default text;
}
declare module "*.json" {
  const value: any;
  export default value;
}
