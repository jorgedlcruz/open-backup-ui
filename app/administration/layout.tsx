import { Metadata } from "next";
import { AdministrationNav } from "@/components/administration-nav";
import { Separator } from "@/components/ui/separator";

export const metadata: Metadata = {
    title: "Administration",
    description: "Manage your Veeam settings and preferences.",
};

const sidebarNavItems = [
    {
        title: "Licensing",
        href: "/administration/licensing",
    },
    {
        title: "Data Sources",
        href: "/administration/data-sources",
    },
    {
        title: "Branding",
        href: "/administration/branding",
    },
    {
        title: "Account",
        href: "/administration/account",
    },
];

export default function AdministrationLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="space-y-6 p-10 pb-16 block">
            <div className="space-y-0.5">
                <h2 className="text-2xl font-bold tracking-tight">Administration</h2>
                <p className="text-muted-foreground">
                    Manage your platform settings, licensing, and configurations.
                </p>
            </div>
            <Separator className="my-6" />
            <div className="flex flex-col space-y-8 lg:flex-row lg:space-y-0 lg:space-x-12">
                <aside className="-mx-4 lg:w-1/5">
                    <AdministrationNav items={sidebarNavItems} />
                </aside>
                <div className="flex-1 lg:max-w-4xl">{children}</div>
            </div>
        </div>
    );
}
