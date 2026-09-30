import { Outlet } from "react-router-dom";
import TabBar from "./TabBar";

export default function TabLayout() {
  return (
    <>
      <main className="flex flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>
      <TabBar />
    </>
  );
}
