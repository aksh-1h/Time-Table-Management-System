import './globals.css';
import { Providers } from './providers';

export const metadata = {
  title: 'Scheduler Pro — Timetable Room Assignment',
  description: 'Timetable room assignment system for Faculty of Pharmacy, Parul University. Upload timetables, manage rooms, auto-assign slots.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
