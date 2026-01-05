import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { marked } from 'marked';

const blogDir = path.join(process.cwd(), 'content', 'blog');

export interface BlogPost {
    slug: string;
    title: string;
    date: string;
    description: string;
    author: string;
    category: string;
    image: string;
    content: string;
    readingTime: string;
}

export function getAllPosts(): BlogPost[] {
    if (!fs.existsSync(blogDir)) return [];

    const files = fs.readdirSync(blogDir);
    const posts = files
        .filter(file => file.endsWith('.md'))
        .map(file => {
            const slug = file.replace('.md', '');
            const fullPath = path.join(blogDir, file);
            const fileContents = fs.readFileSync(fullPath, 'utf8');
            const { data, content } = matter(fileContents);

            return {
                slug,
                title: data.title,
                date: data.date,
                description: data.description,
                author: data.author,
                category: data.category,
                image: data.image,
                content: marked(content) as string,
                readingTime: calculateReadingTime(content)
            };
        })
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return posts;
}

export function getPostBySlug(slug: string): BlogPost | null {
    const fullPath = path.join(blogDir, `${slug}.md`);
    if (!fs.existsSync(fullPath)) return null;

    const fileContents = fs.readFileSync(fullPath, 'utf8');
    const { data, content } = matter(fileContents);

    return {
        slug,
        title: data.title,
        date: data.date,
        description: data.description,
        author: data.author,
        category: data.category,
        image: data.image,
        content: marked(content) as string,
        readingTime: calculateReadingTime(content)
    };
}

function calculateReadingTime(text: string): string {
    const wordsPerMinute = 200;
    const noOfWords = text.split(/\s/g).length;
    const minutes = noOfWords / wordsPerMinute;
    const readTime = Math.ceil(minutes);
    return `${readTime} min read`;
}
