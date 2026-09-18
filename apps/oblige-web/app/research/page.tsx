import type { Metadata } from 'next';
import { Suspense } from 'react';
import { WorkspaceResearch } from '@/components/prop-workspace';
export const metadata: Metadata = {title:'Player research',description:'Switch stat categories, lines and books inside one player research workspace.'};
export default function ResearchPage(){return <Suspense fallback={null}><WorkspaceResearch/></Suspense>;}
