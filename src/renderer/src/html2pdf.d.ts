// Ambient module declaration for html2pdf.js (no @types/* available)
declare module 'html2pdf.js' {
  interface Html2PdfInstance {
    set(opts: unknown): Html2PdfInstance;
    from(el: HTMLElement | string): Html2PdfInstance;
    toPdf(): Html2PdfInstance;
    output(type: 'blob' | 'save' | 'datauristring' | 'dataurlstring'): Promise<Blob>;
    outputPdf(type: 'blob' | 'save' | 'datauristring' | 'dataurlstring'): Promise<Blob>;
    save(filename?: string): Promise<Html2PdfInstance>;
  }
  function html2pdf(): Html2PdfInstance;
  export default html2pdf;
}
