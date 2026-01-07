import { redirect } from 'next/navigation';

export default function IdentityPage() {
    // If the user lands on /administration/identity, we default to the users tab,
    // but if they had a tab selected (conceptually, though we use sub-routes now), handle it.

    // Actually, we are splitting into /users and /roles subdirectories for cleaner Next.js structure
    // So this page is just a redirector.

    redirect('/administration/identity/users');
}
