export default function ConnectLayout({
    children,
}: {
    children: React.ReactNode
}) {
    // Connect page has no sidebar - clean minimal layout
    return <>{children}</>
}
