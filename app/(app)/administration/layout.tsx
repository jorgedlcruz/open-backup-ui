import { Metadata } from "next";



export const metadata: Metadata = {
    title: "Administration",
    description: "Manage your Veeam settings and preferences.",
};

export default function AdministrationLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            {children}
        </>
    );
}
