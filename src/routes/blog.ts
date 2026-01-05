import { Router } from "express";
import { getAllPosts, getPostBySlug } from "@/util/blog";

const router = Router();

// Blog Index
router.get("/", (req, res) => {
    const posts = getAllPosts();
    res.render("blog", { 
        posts,
        title: "Blog – FinalsRS | THE FINALS Guides & Updates",
        description: "Stay ahead of the game with the latest THE FINALS guides, strategy analysis, and FinalsRS bot updates."
    });
});

// Individual Post
router.get("/:slug", (req, res) => {
    const post = getPostBySlug(req.params.slug);
    if (!post) {
        return res.status(404).render("404");
    }
    res.render("blog-post", { 
        post,
        title: `${post.title} | FinalsRS Blog`,
        description: post.description
    });
});

export default router;
