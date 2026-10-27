// Protection semantics stay fixed across themes and platforms, independent of chart accents.
export const protectionColors:Record<string,string>={
  'Within threshold':'#0073e6', 'Outside threshold':'#d95319',
  'No restore points':'#6c757d', 'Unknown':'#475569', 'Count not reported':'#475569',
  'Restore points available':'#237957', 'Failed':'#b93347',
}
export const protectionTextColors:Record<string,string>={
  'Within threshold':'#ffffff', 'Outside threshold':'#101318',
  'No restore points':'#ffffff', 'Unknown':'#ffffff', 'Count not reported':'#ffffff',
  'Restore points available':'#ffffff', 'Failed':'#ffffff',
}
export function protectionStatusLabel(status:string) {
  return status==='Within threshold' ? 'Within RPO':status==='Outside threshold' ? 'Outside RPO':status==='Unknown' ? 'Recovery age unknown':status
}
