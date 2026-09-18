import type { Metadata } from 'next';
import { WorkspaceBoard } from '@/components/prop-workspace';
export const metadata: Metadata = {title:'Player props',description:'One player per game with stat categories, posted lines, books and verified research across the PropLine sports catalog.'};
export default function BoardPage(){return <WorkspaceBoard/>;}
