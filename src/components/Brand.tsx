import logo from '../assets/codesk.svg?no-inline'

export default function Brand() {
  return <span className="inline-flex items-center gap-2.5 text-xl font-semibold tracking-tight">
    <img src={logo} width="34" height="34" alt="" />CoDesk
  </span>
}
